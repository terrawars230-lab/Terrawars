-- ═══════════════════════════════════════════════════════════════════════════
-- 0900 · Read-side functions
--
-- Map viewport (FR-51), leaderboards (FR-60/61/62), profile (FR-04/05).
-- All STABLE, all SECURITY INVOKER unless there is a stated reason otherwise,
-- so RLS still applies.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── FR-51: parcels in a viewport ──────────────────────────────────────────
--
-- doc 04 §4: never send full-resolution geometry to a zoomed-out client.
-- Simplification tolerance is chosen by zoom, and below zoom 12 the response
-- is aggregate counts only. NFR-04 gives this a p95 budget of 400 ms for a
-- bbox holding 2 000 parcels, which is why the geometry is simplified in the
-- database rather than on the phone.
create or replace function public.parcels_in_bbox(
  p_min_lng double precision,
  p_min_lat double precision,
  p_max_lng double precision,
  p_max_lat double precision,
  p_zoom    integer,
  p_limit   integer default 2000
)
returns jsonb
language plpgsql
stable
set search_path = public, extensions
as $fn$
declare
  v_bbox        extensions.geometry;
  v_tolerance_m double precision;
  v_min_area    double precision := 0;
  v_bbox_area   double precision;
  v_features    jsonb;
  v_count       integer;
  v_limit       integer := least(greatest(p_limit, 1), 2000);
  v_uid         uuid := auth.uid();
begin
  if p_min_lng >= p_max_lng or p_min_lat >= p_max_lat then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'ERR_VALIDATION', 'message', 'Invalid bbox')
    );
  end if;

  v_bbox := extensions.st_makeenvelope(p_min_lng, p_min_lat, p_max_lng, p_max_lat, 4326);
  v_bbox_area := extensions.st_area(v_bbox::extensions.geography);

  -- doc 05 §3: bbox area is capped server-side. 50 000 km² is roughly a
  -- country-sized viewport; anything larger belongs in aggregate mode anyway.
  if v_bbox_area > 5e10 and p_zoom >= 12 then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'BBOX_TOO_LARGE', 'message', 'Zoom in to load parcels')
    );
  end if;

  -- doc 04 §4 zoom table.
  if p_zoom >= 16 then
    v_tolerance_m := 0;
  elsif p_zoom >= 14 then
    v_tolerance_m := 5;
  elsif p_zoom >= 12 then
    v_tolerance_m := 20;
    v_min_area := 1000;
  else
    -- Aggregate mode: counts and centroids, no polygons at all.
    select jsonb_build_object(
             'zoom', p_zoom,
             'mode', 'aggregate',
             'features', coalesce(jsonb_agg(f), '[]'::jsonb),
             'truncated', false
           )
      into v_features
      from (
        select jsonb_build_object(
                 'type', 'Feature',
                 'geometry', extensions.st_asgeojson(
                               extensions.st_centroid(extensions.st_collect(p.centroid))
                             )::jsonb,
                 'properties', jsonb_build_object(
                   'parcel_count',  count(*),
                   'total_area_m2', round(sum(p.area_m2)::numeric, 0)
                 )
               ) as f
          from public.parcels p
         where p.centroid && v_bbox
         group by extensions.st_snaptogrid(p.centroid, 0.1)
      ) agg;

    return coalesce(v_features, jsonb_build_object(
      'zoom', p_zoom, 'mode', 'aggregate', 'features', '[]'::jsonb, 'truncated', false
    ));
  end if;

  select count(*) into v_count
    from public.parcels p
   where p.geom && v_bbox
     and p.area_m2 >= v_min_area;

  select coalesce(jsonb_agg(f), '[]'::jsonb)
    into v_features
    from (
      select jsonb_build_object(
               'type', 'Feature',
               'id', p.id,
               'geometry', extensions.st_asgeojson(
                 case
                   when v_tolerance_m = 0 then p.geom
                   else extensions.st_simplifypreservetopology(
                          p.geom,
                          v_tolerance_m / (111320 * greatest(cos(radians(extensions.st_y(p.centroid))), 0.01))
                        )
                 end
               )::jsonb,
               'properties', jsonb_build_object(
                 'owner_id',        p.owner_id,
                 'owner_username',  pr.username,
                 'color_hex',       pr.color_hex,
                 'area_m2',         round(p.area_m2::numeric, 0),
                 'claimed_at',      p.claimed_at,
                 'protected_until', p.protected_until,
                 -- FR-50: the current user's parcels are visually distinct.
                 'is_mine',         (p.owner_id = v_uid)
               )
             ) as f
        from public.parcels p
        join public.profiles pr on pr.id = p.owner_id
       where p.geom && v_bbox
         and p.area_m2 >= v_min_area
       order by p.area_m2 desc
       limit v_limit
    ) features;

  return jsonb_build_object(
    'zoom',      p_zoom,
    'mode',      'geometry',
    'features',  v_features,
    'truncated', v_count > v_limit
  );
end;
$fn$;

comment on function public.parcels_in_bbox is
  'FR-51 viewport query with doc 04 §4 zoom-based simplification. NFR-04: p95 < 400 ms.';

-- ── FR-52: parcel detail for the tap sheet ────────────────────────────────
create or replace function public.parcel_detail(p_parcel_id uuid)
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  select jsonb_build_object(
    'id',              p.id,
    'owner_id',        p.owner_id,
    'owner_username',  pr.username,
    'color_hex',       pr.color_hex,
    'area_m2',         round(p.area_m2::numeric, 0),
    'area_display',    public.format_area(p.area_m2),
    'claimed_at',      p.claimed_at,
    'protected_until', p.protected_until,
    'is_protected',    (p.protected_until is not null and p.protected_until > now()),
    'is_mine',         (p.owner_id = auth.uid()),
    'geometry',        extensions.st_asgeojson(p.geom)::jsonb
  )
  from public.parcels p
  join public.profiles pr on pr.id = p.owner_id
  where p.id = p_parcel_id;
$fn$;

-- ── FR-60/61/62: leaderboards ─────────────────────────────────────────────
--
-- doc 06 §3: users under review or shadow-suspended vanish from public boards
-- with no error and no explanation. `is_leaderboard_eligible` is the filter.
create or replace function public.leaderboard_global(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  with ranked as (
    select row_number() over (order by us.total_area_m2 desc, p.username) as rank,
           p.id, p.username, p.color_hex, us.total_area_m2 as value_m2
      from public.user_stats us
      join public.profiles p on p.id = us.user_id
     where us.total_area_m2 > 0
       and public.is_leaderboard_eligible(p)
  )
  select jsonb_build_object(
    'scope', 'global',
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank',      r.rank,
               'user_id',   r.id,
               'username',  r.username,
               'color_hex', r.color_hex,
               'value_m2',  round(r.value_m2::numeric, 0)
             ) order by r.rank)
        from (select * from ranked order by rank limit least(p_limit, 100) offset p_offset) r
    ), '[]'::jsonb),
    -- FR-63: `me` is always populated, even outside the returned page.
    'me', (
      select jsonb_build_object('rank', r.rank, 'value_m2', round(r.value_m2::numeric, 0))
        from ranked r where r.id = auth.uid()
    )
  );
$fn$;

create or replace function public.leaderboard_weekly(
  p_limit  integer default 50,
  p_offset integer default 0
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  with period as (
    -- FR-61: resets Monday 00:00 UTC. The database owns the week boundary.
    select extract(isoyear from now())::smallint as iso_year,
           extract(week    from now())::smallint as iso_week
  ),
  ranked as (
    select row_number() over (order by ws.area_gained_m2 desc, p.username) as rank,
           p.id, p.username, p.color_hex, ws.area_gained_m2 as value_m2
      from public.weekly_scores ws
      join public.profiles p on p.id = ws.user_id
     cross join period
     where ws.iso_year = period.iso_year
       and ws.iso_week = period.iso_week
       and public.is_leaderboard_eligible(p)
  )
  select jsonb_build_object(
    'scope', 'weekly',
    'period', (select jsonb_build_object('iso_year', iso_year, 'iso_week', iso_week) from period),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank',      r.rank,
               'user_id',   r.id,
               'username',  r.username,
               'color_hex', r.color_hex,
               'value_m2',  round(r.value_m2::numeric, 0)
             ) order by r.rank)
        from (select * from ranked order by rank limit least(p_limit, 100) offset p_offset) r
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object('rank', r.rank, 'value_m2', round(r.value_m2::numeric, 0))
        from ranked r where r.id = auth.uid()
    )
  );
$fn$;

create or replace function public.leaderboard_local(
  p_city  text,
  p_limit integer default 50
)
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  with ranked as (
    select row_number() over (order by us.total_area_m2 desc, p.username) as rank,
           p.id, p.username, p.color_hex, us.total_area_m2 as value_m2
      from public.user_stats us
      join public.profiles p on p.id = us.user_id
     where p.home_city is not distinct from p_city
       and us.total_area_m2 > 0
       and public.is_leaderboard_eligible(p)
  )
  select jsonb_build_object(
    'scope', 'local',
    'city',  p_city,
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'rank',      r.rank,
               'user_id',   r.id,
               'username',  r.username,
               'color_hex', r.color_hex,
               'value_m2',  round(r.value_m2::numeric, 0)
             ) order by r.rank)
        from (select * from ranked order by rank limit least(p_limit, 100)) r
    ), '[]'::jsonb),
    'me', (
      select jsonb_build_object('rank', r.rank, 'value_m2', round(r.value_m2::numeric, 0))
        from ranked r where r.id = auth.uid()
    )
  );
$fn$;

-- ── FR-04: the signed-in user's own profile + stats ───────────────────────
create or replace function public.get_me()
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  select jsonb_build_object(
    'id',            p.id,
    'username',      p.username,
    'display_name',  p.display_name,
    'avatar_url',    p.avatar_url,
    'color_hex',     p.color_hex,
    'home_city',     p.home_city,
    'home_region',   p.home_region,
    -- The app treats a `user_`-prefixed username as "not chosen yet" (FR-02).
    'needs_username', (p.username like 'user\_%'),
    'created_at',    p.created_at,
    'stats', jsonb_build_object(
      'total_area_m2',    round(us.total_area_m2::numeric, 0),
      'area_display',     public.format_area(us.total_area_m2),
      'parcels_count',    us.parcels_count,
      'total_distance_m', round(us.total_distance_m::numeric, 0),
      'walks_count',      us.walks_count,
      'claims_count',     us.claims_count,
      'area_stolen_m2',   round(us.area_stolen_m2::numeric, 0),
      'area_lost_m2',     round(us.area_lost_m2::numeric, 0),
      'steals_made',      us.steals_made,
      'best_claim_m2',    round(us.best_claim_m2::numeric, 0),
      'rank_global',      public.user_global_rank(p.id)
    )
  )
  from public.profiles p
  join public.user_stats us on us.user_id = p.id
  where p.id = auth.uid();
$fn$;

-- ── FR-05: another player's public profile ────────────────────────────────
--
-- Public fields only. NEVER returns walks, paths or points — that polyline is
-- someone's home address (doc 06 §4.1).
create or replace function public.get_public_profile(p_username text)
returns jsonb
language sql
stable
set search_path = public, extensions
as $fn$
  select jsonb_build_object(
    'id',           p.id,
    'username',     p.username,
    'display_name', p.display_name,
    'color_hex',    p.color_hex,
    'home_city',    p.home_city,
    'created_at',   p.created_at,
    'stats', jsonb_build_object(
      'total_area_m2',  round(us.total_area_m2::numeric, 0),
      'area_display',   public.format_area(us.total_area_m2),
      'parcels_count',  us.parcels_count,
      'walks_count',    us.walks_count,
      'area_stolen_m2', round(us.area_stolen_m2::numeric, 0),
      'area_lost_m2',   round(us.area_lost_m2::numeric, 0),
      'steals_made',    us.steals_made,
      'rank_global',    public.user_global_rank(p.id)
    )
  )
  from public.profiles p
  join public.user_stats us on us.user_id = p.id
  where p.username = p_username
    and p.deleted_at is null;
$fn$;

-- ── FR-03: colour change, once per 30 days ────────────────────────────────
create or replace function public.update_my_color(p_color_hex text)
returns jsonb
language plpgsql
set search_path = public, extensions
as $fn$
declare
  v_changed_at timestamptz;
begin
  if p_color_hex !~ '^#[0-9A-Fa-f]{6}$' then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'ERR_VALIDATION', 'message', 'Invalid colour')
    );
  end if;

  select color_changed_at into v_changed_at
    from public.profiles where id = auth.uid();

  if v_changed_at is not null and v_changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'COLOR_CHANGE_COOLDOWN',
        'message', 'You can change your colour once every 30 days',
        'details', jsonb_build_object('available_at', v_changed_at + interval '30 days')
      )
    );
  end if;

  update public.profiles
     set color_hex = p_color_hex, color_changed_at = now()
   where id = auth.uid();

  return jsonb_build_object('color_hex', p_color_hex);
end;
$fn$;

-- ── FR-06 / doc 06 §5: account deletion ───────────────────────────────────
--
-- Soft-delete now, hard-delete after a 7-day grace period. Parcels are NOT
-- cascade-deleted: doing so would punch holes in the world map and break other
-- players' history. They are reassigned to a `[deleted]` system owner and stay
-- claimable normally.
create or replace function public.request_account_deletion()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Sign in required')
    );
  end if;

  update public.profiles
     set deleted_at   = now(),
         display_name = null,
         avatar_url   = null,
         home_city    = null,
         home_region  = null
   where id = v_uid;

  -- Raw location data goes immediately; it is the sensitive part (doc 06 §4).
  delete from public.walk_points wp
   using public.walks w
   where wp.walk_id = w.id and w.user_id = v_uid;

  update public.walks set path = null where user_id = v_uid;

  delete from public.push_tokens where user_id = v_uid;

  return jsonb_build_object('status', 'deletion_requested', 'grace_period_days', 7);
end;
$fn$;

-- ── Grants ────────────────────────────────────────────────────────────────
revoke all on function public.request_account_deletion() from public;
grant execute on function public.request_account_deletion() to authenticated;

grant execute on function public.parcels_in_bbox(double precision, double precision,
                                                 double precision, double precision,
                                                 integer, integer) to authenticated;
grant execute on function public.parcel_detail(uuid) to authenticated;
grant execute on function public.leaderboard_global(integer, integer) to authenticated;
grant execute on function public.leaderboard_weekly(integer, integer) to authenticated;
grant execute on function public.leaderboard_local(text, integer) to authenticated;
grant execute on function public.get_me() to authenticated;
grant execute on function public.get_public_profile(text) to authenticated;
grant execute on function public.update_my_color(text) to authenticated;
