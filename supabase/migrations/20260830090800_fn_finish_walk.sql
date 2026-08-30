-- ═══════════════════════════════════════════════════════════════════════════
-- 0800 · finish_walk — GR-11, GR-20, GR-21, GR-23, GR-24
--
-- The single write path for `parcels`, `claims`, `steal_events` and
-- `user_stats`. SECURITY DEFINER with a pinned search_path, because the client
-- role has no write policy on any of those tables (doc 04 §6).
--
-- FR-33 / GR-11: one atomic transaction. Either the claimer gains and every
-- victim loses, or nothing changes. A PL/pgSQL body already runs inside the
-- caller's transaction, so atomicity is free — what is NOT free is the locking
-- order, which is why every intersecting parcel is taken
-- `FOR UPDATE ORDER BY id` before any of them is touched.
--
-- It returns a structured result rather than raising for anything the user
-- caused (doc 04 §3). Only a genuine server fault raises.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.finish_walk(
  p_walk_id         uuid,
  p_idempotency_key text default null,
  p_ended_at        timestamptz default null,
  p_attempt_claim   boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_user_id            uuid := auth.uid();
  v_walk               public.walks%rowtype;
  v_existing_claim     public.claims%rowtype;

  v_build              record;
  v_claim_id           uuid;
  v_claim_geom         extensions.geometry;

  v_protection_hours   double precision;
  v_min_parcel_area    double precision;
  v_merge_gap_m        double precision;
  v_max_claims_per_day integer;
  v_mock_ratio_limit   constant double precision := 0.05;  -- doc 06 §3(2)

  v_locked_ids         uuid[];
  v_rival              record;
  v_part               record;

  v_own_geom           extensions.geometry;
  v_own_area_before    double precision := 0;
  v_merged             extensions.geometry;
  v_closing_radius     double precision;
  v_overlap            extensions.geometry;
  v_remainder          extensions.geometry;

  v_stolen_total       double precision := 0;
  v_steals             jsonb := '[]'::jsonb;
  v_blocked            jsonb := '[]'::jsonb;
  v_victim_count       integer := 0;
  v_net_gain           double precision := 0;
  v_final_area         double precision := 0;
  v_recent_claims      integer;
  v_iso_year           smallint;
  v_iso_week           smallint;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'status', 'error',
      'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Sign in required')
    );
  end if;

  -- GR-24 / doc 04 §3: serialise concurrent submissions of the SAME walk. Two
  -- taps on "finish" across a flaky link must not both resolve.
  perform pg_advisory_xact_lock(hashtextextended(p_walk_id::text, 0));

  select * into v_walk from public.walks where id = p_walk_id;

  if not found or v_walk.user_id <> v_user_id then
    return jsonb_build_object(
      'status', 'error',
      'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Walk not found')
    );
  end if;

  -- GR-24 idempotency: a walk is claimable exactly once. Replay the stored
  -- outcome rather than resolving it again.
  select * into v_existing_claim from public.claims where walk_id = p_walk_id;
  if found then
    return public.claim_result_json(v_existing_claim.id);
  end if;

  if v_walk.status <> 'active' then
    return jsonb_build_object(
      'status', 'error',
      'error', jsonb_build_object('code', 'WALK_ALREADY_FINISHED', 'message', 'Walk already finished')
    );
  end if;

  v_protection_hours   := public.config_number('PROTECTION_HOURS');
  v_min_parcel_area    := public.config_number('MIN_PARCEL_AREA_M2');
  v_merge_gap_m        := public.config_number('MERGE_GAP_M');
  v_max_claims_per_day := public.config_int('MAX_CLAIMS_PER_DAY');

  -- ── Always close and save the walk first ────────────────────────────────
  --
  -- doc 03 §6: in every rejection case the walk is still saved with its
  -- distance and duration. The user did the exercise; do not throw that away.
  select * into v_build from public.build_claim_polygon(p_walk_id);

  update public.walks
     set status        = 'completed',
         ended_at      = coalesce(p_ended_at, now()),
         duration_s    = greatest(coalesce(v_build.duration_s, 0), 0)::integer,
         distance_m    = v_build.path_length_m,
         avg_speed_mps = v_build.avg_speed_mps,
         point_count   = v_build.point_count,
         path          = case
                           when coalesce(v_build.point_count, 0) >= 2 then (
                             select extensions.st_setsrid(
                                      extensions.st_makeline(
                                        array_agg(c.geog::extensions.geometry order by c.seq_no)
                                      ), 4326)
                               from public.clean_walk_points(p_walk_id) c
                           )
                           else null
                         end
   where id = p_walk_id;

  update public.user_stats
     set walks_count      = walks_count + 1,
         total_distance_m = total_distance_m + coalesce(v_build.path_length_m, 0),
         last_walk_at     = now()
   where user_id = v_user_id;

  v_iso_year := extract(isoyear from now())::smallint;
  v_iso_week := extract(week    from now())::smallint;

  insert into public.weekly_scores (user_id, iso_year, iso_week, distance_m)
  values (v_user_id, v_iso_year, v_iso_week, coalesce(v_build.path_length_m, 0))
  on conflict (user_id, iso_year, iso_week)
    do update set distance_m = weekly_scores.distance_m + excluded.distance_m;

  if not p_attempt_claim then
    return jsonb_build_object(
      'status', 'completed',
      'walk',   public.walk_summary_json(p_walk_id)
    );
  end if;

  -- ── Hard rejections ────────────────────────────────────────────────────

  -- doc 06 §3(2): mock locations on more than 5% of points.
  if coalesce(v_build.mock_ratio, 0) > v_mock_ratio_limit then
    return public.reject_claim(p_walk_id, v_user_id, 'ERR_INTEGRITY', p_idempotency_key);
  end if;

  -- GR-01 … GR-05 rejections from build_claim_polygon.
  if v_build.error_code is not null then
    return public.reject_claim(p_walk_id, v_user_id, v_build.error_code, p_idempotency_key);
  end if;

  -- GR-24: max accepted claims per rolling 24 h.
  select count(*) into v_recent_claims
    from public.claims
   where user_id = v_user_id
     and status = 'accepted'
     and created_at > now() - interval '24 hours';

  if v_recent_claims >= v_max_claims_per_day then
    return public.reject_claim(p_walk_id, v_user_id, 'RATE_LIMITED', p_idempotency_key);
  end if;

  v_claim_geom := v_build.geom;

  -- ── GR-11 step 1: lock every affected parcel, ordered by id ────────────
  --
  -- One statement takes every lock this transaction will need, in a
  -- deterministic order. That consistent order is what stops two players
  -- finishing overlapping claims at the same instant from deadlocking
  -- (doc 07, Phase 4 acceptance).
  --
  -- Own parcels merely NEAR the claim are included too, because GR-21 will
  -- merge them and they must be locked before they are read.
  --
  -- Isolation note: under READ COMMITTED a concurrent claim that commits while
  -- this one waits is re-checked row by row as each lock is granted, so no
  -- parcel is ever double-spent. A parcel that concurrent claim *created* is
  -- outside this snapshot and is simply not contested by this claim — the next
  -- walk over that ground will take it.
  select array_agg(locked.id order by locked.id)
    into v_locked_ids
    from (
      select p.id
        from public.parcels p
       where extensions.st_intersects(p.geom, v_claim_geom)
          or (
            p.owner_id = v_user_id
            and extensions.st_dwithin(
                  p.geom::extensions.geography,
                  v_claim_geom::extensions.geography,
                  v_merge_gap_m
                )
          )
       order by p.id
         for update
    ) locked;

  v_locked_ids := coalesce(v_locked_ids, array[]::uuid[]);

  -- ── GR-20: stealing from rivals ────────────────────────────────────────
  for v_rival in
    select p.id, p.owner_id, p.geom, p.claimed_at, p.protected_until
      from public.parcels p
     where p.id = any(v_locked_ids)
       and p.owner_id <> v_user_id
     order by p.id
  loop
    -- GR-20 / GR-23: a protected parcel CLIPS the claim instead of being taken.
    -- The claimer keeps everything outside it and gains nothing from inside —
    -- they walk around protected land, it does not void the rest of the claim.
    if v_rival.protected_until is not null and v_rival.protected_until > now() then
      v_blocked := v_blocked || jsonb_build_object(
        'parcel_id',       v_rival.id,
        'owner_id',        v_rival.owner_id,
        'owner_username',  (select username from public.profiles where id = v_rival.owner_id),
        'area_m2',         round(extensions.st_area(
                             extensions.st_intersection(v_rival.geom, v_claim_geom)::extensions.geography
                           )::numeric, 1),
        'protected_until', v_rival.protected_until
      );

      v_claim_geom := extensions.st_makevalid(
        extensions.st_difference(v_claim_geom, v_rival.geom)
      );
      continue;
    end if;

    v_overlap := extensions.st_intersection(v_rival.geom, v_claim_geom);
    if v_overlap is null or extensions.st_isempty(v_overlap) then
      continue;
    end if;

    v_stolen_total := v_stolen_total + extensions.st_area(v_overlap::extensions.geography);

    v_steals := v_steals || jsonb_build_object(
      'victim_id', v_rival.owner_id,
      'area_m2',   extensions.st_area(v_overlap::extensions.geography)
    );

    v_remainder := extensions.st_makevalid(
      extensions.st_difference(v_rival.geom, v_claim_geom)
    );

    -- GR-20: an empty remainder means the parcel was fully conquered.
    delete from public.parcels where id = v_rival.id;

    if v_remainder is not null and not extensions.st_isempty(v_remainder) then
      -- GR-20: a MULTIPOLYGON remainder becomes one parcel row per part,
      -- keeping the victim's ORIGINAL claimed_at and protected_until. GR-23 is
      -- explicit that a parcel which only LOST area must not gain protection —
      -- otherwise being raided would reward the victim.
      for v_part in
        select d.geom as g
          from extensions.st_dump(v_remainder) as d
         where extensions.geometrytype(d.geom) = 'POLYGON'
      loop
        -- GR-20 sliver rule: a remainder under MIN_PARCEL_AREA_M2 is discarded,
        -- and its area goes to the claimer along with the rest.
        if extensions.st_area(v_part.g::extensions.geography) >= v_min_parcel_area then
          insert into public.parcels (owner_id, geom, claimed_at, protected_until, origin_claim_id)
          values (v_rival.owner_id, v_part.g, v_rival.claimed_at, v_rival.protected_until, null);
        end if;
      end loop;
    end if;
  end loop;

  -- Everything enclosed was protected land: the claim clipped away to nothing.
  if v_claim_geom is null or extensions.st_isempty(v_claim_geom) then
    return public.reject_claim(p_walk_id, v_user_id, 'ERR_AREA_TOO_SMALL', p_idempotency_key)
           || jsonb_build_object('blocked', v_blocked);
  end if;

  -- ── GR-21: merging with your own land (FR-43) ──────────────────────────
  --
  -- Own parcels merge, they are never stolen.
  select extensions.st_union(p.geom), coalesce(sum(p.area_m2), 0)
    into v_own_geom, v_own_area_before
    from public.parcels p
   where p.id = any(v_locked_ids)
     and p.owner_id = v_user_id;

  if v_own_geom is not null then
    delete from public.parcels
     where id = any(v_locked_ids)
       and owner_id = v_user_id;

    -- A morphological closing (buffer out, then back in) over MERGE_GAP_M.
    --
    -- A plain ST_Union of two parcels separated by a 2 m gap returns a
    -- MULTIPOLYGON — two rows, and the hairline crack GR-21 exists to remove is
    -- still there. Buffering out by half the gap makes them touch, and buffering
    -- back in restores the outer boundary. Applied ONLY when there is own land
    -- to merge, so a plain first claim keeps its exact walked corners.
    v_closing_radius := (v_merge_gap_m / 2) + 0.05;

    v_merged := extensions.st_makevalid(
      extensions.st_buffer(
        extensions.st_buffer(
          extensions.st_union(v_claim_geom, v_own_geom)::extensions.geography,
          v_closing_radius
        )::extensions.geometry::extensions.geography,
        -v_closing_radius
      )::extensions.geometry
    );

    -- If the closing collapsed the geometry (possible on a very thin parcel),
    -- fall back to the plain union: two rows beat zero rows.
    if v_merged is null or extensions.st_isempty(v_merged) then
      v_merged := extensions.st_makevalid(extensions.st_union(v_claim_geom, v_own_geom));
    end if;
  else
    v_merged := extensions.st_makevalid(v_claim_geom);
  end if;

  if v_merged is null or extensions.st_isempty(v_merged) then
    return public.reject_claim(p_walk_id, v_user_id, 'ERR_AREA_TOO_SMALL', p_idempotency_key);
  end if;

  -- ── Record the claim ───────────────────────────────────────────────────
  insert into public.claims (
    walk_id, user_id, status, geom, raw_area_m2, perimeter_m, stolen_area_m2, idempotency_key
  )
  values (
    p_walk_id, v_user_id, 'accepted',
    v_build.geom, v_build.area_m2, v_build.perimeter_m, v_stolen_total, p_idempotency_key
  )
  returning id into v_claim_id;

  -- ── Insert the resulting parcel(s) ─────────────────────────────────────
  --
  -- GR-23: a newly claimed OR newly merged parcel receives a fresh protection
  -- window. Walking your own perimeter to refresh protection is a deliberate,
  -- healthy defensive mechanic.
  for v_part in
    select d.geom as g
      from extensions.st_dump(v_merged) as d
     where extensions.geometrytype(d.geom) = 'POLYGON'
  loop
    if extensions.st_area(v_part.g::extensions.geography) >= v_min_parcel_area then
      insert into public.parcels (owner_id, geom, origin_claim_id, claimed_at, protected_until)
      values (
        v_user_id,
        v_part.g,
        v_claim_id,
        now(),
        now() + make_interval(hours => v_protection_hours::integer)
      );
    end if;
  end loop;

  -- GR-21: net gain is the merged total minus what the user already owned —
  -- NOT the raw claim area. Re-walking the same loop must yield ~0.
  select coalesce(sum(p.area_m2), 0)
    into v_final_area
    from public.parcels p
   where p.origin_claim_id = v_claim_id;

  v_net_gain := v_final_area - v_own_area_before;

  update public.claims
     set net_area_gain_m2 = v_net_gain
   where id = v_claim_id;

  -- ── GR-11 step 7: ONE steal_event per victim ───────────────────────────
  --
  -- A single claim can take land from several parcels owned by the same
  -- player; that is one raid, not three, so the areas are summed per victim.
  with per_victim as (
    select (s ->> 'victim_id')::uuid          as victim_id,
           sum((s ->> 'area_m2')::double precision) as area_m2
      from jsonb_array_elements(v_steals) as s
     group by 1
    having sum((s ->> 'area_m2')::double precision) > 0
  )
  insert into public.steal_events (claim_id, attacker_id, victim_id, area_m2)
  select v_claim_id, v_user_id, pv.victim_id, pv.area_m2
    from per_victim pv;

  get diagnostics v_victim_count = row_count;

  -- ── GR-11 step 6: recompute stats for the claimer and every victim ─────
  perform public.recompute_user_stats(v_user_id);

  perform public.recompute_user_stats(se.victim_id)
     from public.steal_events se
    where se.claim_id = v_claim_id;

  update public.user_stats
     set claims_count    = claims_count + 1,
         area_stolen_m2  = area_stolen_m2 + v_stolen_total,
         steals_made     = steals_made + v_victim_count,
         best_claim_m2   = greatest(best_claim_m2, v_net_gain)
   where user_id = v_user_id;

  update public.user_stats us
     set area_lost_m2 = us.area_lost_m2 + se.area_m2
    from public.steal_events se
   where se.claim_id = v_claim_id
     and us.user_id = se.victim_id;

  -- FR-61: the weekly board tracks area GAINED, and goes negative for a victim.
  insert into public.weekly_scores (user_id, iso_year, iso_week, area_gained_m2)
  values (v_user_id, v_iso_year, v_iso_week, v_net_gain)
  on conflict (user_id, iso_year, iso_week)
    do update set area_gained_m2 = weekly_scores.area_gained_m2 + excluded.area_gained_m2;

  insert into public.weekly_scores (user_id, iso_year, iso_week, area_gained_m2)
  select se.victim_id, v_iso_year, v_iso_week, -se.area_m2
    from public.steal_events se
   where se.claim_id = v_claim_id
  on conflict (user_id, iso_year, iso_week)
    do update set area_gained_m2 = weekly_scores.area_gained_m2 + excluded.area_gained_m2;

  return public.claim_result_json(v_claim_id) || jsonb_build_object('blocked', v_blocked);
end;
$fn$;

comment on function public.finish_walk is
  'GR-11/GR-20/GR-21/GR-23/GR-24. The ONLY write path for parcels, claims, '
  'steal_events and user_stats (CLAUDE.md rule 1). Atomic per FR-33.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Helpers used by finish_walk
-- ═══════════════════════════════════════════════════════════════════════════

-- Records a rejected claim and returns the doc 05 §2 rejection envelope. The
-- walk itself has already been saved by the caller (doc 03 §6).
create or replace function public.reject_claim(
  p_walk_id         uuid,
  p_user_id         uuid,
  p_error_code      text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_claim_id uuid;
begin
  insert into public.claims (walk_id, user_id, status, error_code, idempotency_key)
  values (p_walk_id, p_user_id, 'rejected', p_error_code, p_idempotency_key)
  on conflict (walk_id) do update set error_code = excluded.error_code
  returning id into v_claim_id;

  update public.walks set reject_reason = p_error_code where id = p_walk_id;

  return jsonb_build_object(
    'status',     'rejected',
    'claim_id',   v_claim_id,
    'error_code', p_error_code,
    'walk',       public.walk_summary_json(p_walk_id)
  );
end;
$fn$;

-- Walk facts for the result screen. Ownership has already been verified by the
-- caller, which is the only thing allowed to call this.
create or replace function public.walk_summary_json(p_walk_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select jsonb_build_object(
    'id',            w.id,
    'distance_m',    round(coalesce(w.distance_m, 0)::numeric, 1),
    'duration_s',    coalesce(w.duration_s, 0),
    'avg_speed_mps', round(coalesce(w.avg_speed_mps, 0)::numeric, 2),
    'point_count',   coalesce(w.point_count, 0),
    'started_at',    w.started_at,
    'ended_at',      w.ended_at
  )
  from public.walks w
  where w.id = p_walk_id;
$fn$;

-- The accepted-claim envelope from doc 05 §2.
create or replace function public.claim_result_json(p_claim_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_claim public.claims%rowtype;
begin
  select * into v_claim from public.claims where id = p_claim_id;

  if not found then
    return jsonb_build_object(
      'status', 'error',
      'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'Claim not found')
    );
  end if;

  if v_claim.status = 'rejected' then
    return jsonb_build_object(
      'status',     'rejected',
      'claim_id',   v_claim.id,
      'error_code', v_claim.error_code,
      'walk',       public.walk_summary_json(v_claim.walk_id)
    );
  end if;

  return jsonb_build_object(
    'status',   'accepted',
    'claim_id', v_claim.id,
    'walk',     public.walk_summary_json(v_claim.walk_id),
    'claim', jsonb_build_object(
      'id',               v_claim.id,
      'raw_area_m2',      round(v_claim.raw_area_m2::numeric, 1),
      'net_area_gain_m2', round(coalesce(v_claim.net_area_gain_m2, 0)::numeric, 1),
      'stolen_area_m2',   round(coalesce(v_claim.stolen_area_m2, 0)::numeric, 1),
      'geometry',         extensions.st_asgeojson(v_claim.geom)::jsonb
    ),
    'steals', coalesce((
      select jsonb_agg(jsonb_build_object(
               'victim_username', p.username,
               'color_hex',       p.color_hex,
               'area_m2',         round(se.area_m2::numeric, 1)
             ))
        from public.steal_events se
        join public.profiles p on p.id = se.victim_id
       where se.claim_id = v_claim.id
    ), '[]'::jsonb),
    'blocked', '[]'::jsonb,
    'stats', (
      select jsonb_build_object(
               'total_area_m2', round(us.total_area_m2::numeric, 1),
               'area_display',  public.format_area(us.total_area_m2),
               'parcels_count', us.parcels_count,
               'rank_global',   public.user_global_rank(us.user_id)
             )
        from public.user_stats us
       where us.user_id = v_claim.user_id
    )
  );
end;
$fn$;

-- Recomputes the parcel-derived half of user_stats. Cheap: one indexed
-- aggregate over the user's own parcels, never a scan of the world.
create or replace function public.recompute_user_stats(p_user_id uuid)
returns void
language sql
security definer
set search_path = public, extensions
as $fn$
  update public.user_stats us
     set total_area_m2 = coalesce(agg.total_area, 0),
         parcels_count = coalesce(agg.parcel_count, 0)
    from (
      select coalesce(sum(p.area_m2), 0) as total_area,
             count(*)                    as parcel_count
        from public.parcels p
       where p.owner_id = p_user_id
    ) agg
   where us.user_id = p_user_id;
$fn$;

-- FR-63: the user's own rank is always visible, even outside the top 100.
create or replace function public.user_global_rank(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select count(*)::integer + 1
    from public.user_stats us
    join public.profiles p on p.id = us.user_id
   where us.total_area_m2 > coalesce(
           (select total_area_m2 from public.user_stats where user_id = p_user_id), 0
         )
     and public.is_leaderboard_eligible(p);
$fn$;

-- ── Grants ────────────────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function is executable by PUBLIC unless revoked, so each
-- one is locked down explicitly. Helpers only finish_walk should ever call are
-- revoked outright and never granted back.

revoke all on function public.finish_walk(uuid, text, timestamptz, boolean) from public;
grant execute on function public.finish_walk(uuid, text, timestamptz, boolean) to authenticated;

revoke all on function public.reject_claim(uuid, uuid, text, text) from public;
revoke all on function public.recompute_user_stats(uuid) from public;
revoke all on function public.walk_summary_json(uuid) from public;
revoke all on function public.claim_result_json(uuid) from public;

revoke all on function public.user_global_rank(uuid) from public;
grant execute on function public.user_global_rank(uuid) to authenticated;
