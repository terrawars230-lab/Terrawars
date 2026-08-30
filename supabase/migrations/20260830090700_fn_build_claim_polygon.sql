-- ═══════════════════════════════════════════════════════════════════════════
-- 0700 · build_claim_polygon — GR-01 … GR-05
--
-- The authoritative implementation. The client mirrors this in `src/geo/` for
-- its live preview, but D-05 and CLAUDE.md rule 1 are absolute: only what
-- happens here counts.
--
-- Returns a row of metrics plus either a polygon or an error code. It never
-- raises for anything the user caused — a rejection is a normal outcome
-- (doc 05 §7) and the walk is still saved (doc 03 §6).
-- ═══════════════════════════════════════════════════════════════════════════

-- ── GR-01: point cleaning ─────────────────────────────────────────────────
--
-- Returns the accepted points in order, plus a running teleport count so the
-- caller can apply the two-teleport rejection.
create or replace function public.clean_walk_points(p_walk_id uuid)
returns table (
  -- Prefixed names, not `ts`/`lat`/`lng`: a PL/pgSQL OUT parameter shadows a
  -- column of the same name inside the body, which turns a typo into a silent
  -- wrong answer rather than an error.
  seq_no         integer,
  sample_ts      timestamptz,
  sample_lat     double precision,
  sample_lng     double precision,
  geog           extensions.geography,
  teleport_count integer
)
language plpgsql
stable
set search_path = public, extensions
as $fn$
declare
  v_max_accuracy double precision := public.config_number('MAX_ACCURACY_M');
  v_max_burst    double precision := public.config_number('MAX_BURST_SPEED_MPS');
  v_jitter_m     constant double precision := 2;  -- GR-01(4), fixed by the spec
  v_teleports    integer := 0;
  v_prev         extensions.geography := null;
  v_prev_ts      timestamptz := null;
  v_row          record;
  v_distance_m   double precision;
  v_elapsed_s    double precision;
  v_n            integer := 0;
begin
  -- Steps 1–3: accuracy filter, mock filter, chronological order, one point
  -- per timestamp. DISTINCT ON gives the dedupe and the ordering in one pass.
  for v_row in
    select distinct on (wp.ts)
           wp.ts as ts,
           wp.lat as lat,
           wp.lng as lng,
           extensions.st_point(wp.lng, wp.lat, 4326)::extensions.geography as g
      from public.walk_points wp
     where wp.walk_id = p_walk_id
       and (wp.accuracy_m is null or wp.accuracy_m <= v_max_accuracy)
       and not wp.is_mock
     order by wp.ts, wp.seq
  loop
    if v_prev is not null then
      v_distance_m := extensions.st_distance(v_prev, v_row.g);

      -- Step 4: GPS jitter.
      if v_distance_m < v_jitter_m then
        continue;
      end if;

      -- Step 5: teleport. Drop the offending point and re-link — `v_prev` is
      -- deliberately NOT advanced, so a single bad fix is repaired rather than
      -- poisoning every segment that follows it.
      v_elapsed_s := extract(epoch from (v_row.ts - v_prev_ts));
      if v_elapsed_s <= 0 or (v_distance_m / v_elapsed_s) > v_max_burst then
        v_teleports := v_teleports + 1;
        continue;
      end if;
    end if;

    v_n := v_n + 1;
    seq_no         := v_n;
    sample_ts      := v_row.ts;
    sample_lat     := v_row.lat;
    sample_lng     := v_row.lng;
    geog           := v_row.g;
    teleport_count := v_teleports;

    v_prev    := v_row.g;
    v_prev_ts := v_row.ts;
    return next;
  end loop;
end;
$fn$;

comment on function public.clean_walk_points is
  'GR-01 point cleaning. Mirrored by src/geo/cleaning.ts; this one is authoritative.';

-- ═══════════════════════════════════════════════════════════════════════════
-- GR-02 … GR-05: polygon construction and validation
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.build_claim_polygon(p_walk_id uuid)
returns table (
  geom          extensions.geometry,
  area_m2       double precision,
  perimeter_m   double precision,
  path_length_m double precision,
  duration_s    double precision,
  avg_speed_mps double precision,
  point_count   integer,
  teleports     integer,
  mock_ratio    double precision,
  error_code    text
)
language plpgsql
stable
set search_path = public, extensions
as $fn$
declare
  v_min_points    integer          := public.config_int('MIN_POINTS');
  v_close_radius  double precision := public.config_number('LOOP_CLOSE_RADIUS_M');
  v_min_distance  double precision := public.config_number('MIN_WALK_DISTANCE_M');
  v_min_duration  double precision := public.config_number('MIN_WALK_DURATION_S');
  v_min_area      double precision := public.config_number('MIN_CLAIM_AREA_M2');
  v_max_area      double precision := public.config_number('MAX_CLAIM_AREA_M2');
  v_max_speed     double precision := public.config_number('MAX_SPEED_MPS');
  v_simplify_m    double precision := public.config_number('SIMPLIFY_TOLERANCE_M');
  v_iso_tolerance double precision := public.config_number('ISOPERIMETRIC_TOLERANCE');

  v_points        extensions.geometry[];
  v_line_geom     extensions.geometry;
  v_rings         extensions.geometry;
  v_polygon       extensions.geometry;
  v_simplified    extensions.geometry;
  v_raw_count     integer;
  v_mock_count    integer;
  v_first_ts      timestamptz;
  v_last_ts       timestamptz;
  v_simplify_deg  double precision;
  v_centre_lat    double precision;
begin
  -- Defaults returned alongside every rejection, so the caller can always save
  -- distance and duration (doc 03 §6).
  geom := null; area_m2 := 0; perimeter_m := 0; path_length_m := 0;
  duration_s := 0; avg_speed_mps := 0; point_count := 0; teleports := 0;
  mock_ratio := 0; error_code := null;

  select count(*), count(*) filter (where wp.is_mock)
    into v_raw_count, v_mock_count
    from public.walk_points wp
   where wp.walk_id = p_walk_id;

  mock_ratio := case
                  when v_raw_count > 0 then v_mock_count::double precision / v_raw_count
                  else 0
                end;

  select array_agg(c.geog::extensions.geometry order by c.seq_no),
         count(*)::integer,
         coalesce(max(c.teleport_count), 0),
         min(c.sample_ts),
         max(c.sample_ts)
    into v_points, point_count, teleports, v_first_ts, v_last_ts
    from public.clean_walk_points(p_walk_id) c;

  -- GR-01(5): two or more teleports reject the walk.
  if teleports >= 2 then
    error_code := 'ERR_TELEPORT';
    return next;
    return;
  end if;

  -- GR-01(6)
  if point_count is null or point_count < v_min_points then
    error_code := 'ERR_TOO_FEW_POINTS';
    return next;
    return;
  end if;

  duration_s    := extract(epoch from (v_last_ts - v_first_ts));
  v_line_geom   := extensions.st_setsrid(extensions.st_makeline(v_points), 4326);
  path_length_m := extensions.st_length(v_line_geom::extensions.geography);
  avg_speed_mps := case when duration_s > 0 then path_length_m / duration_s else 0 end;

  -- ── GR-02: loop closure ────────────────────────────────────────────────
  --
  -- (b) self-intersection first: it is both the common real-world case and the
  -- tighter ring. ST_Node splits the line at every crossing, and ST_Polygonize
  -- assembles whatever closed rings those crossings form. No rings means no
  -- segment ever crossed another.
  v_rings := extensions.st_polygonize(extensions.st_node(v_line_geom));

  if v_rings is not null and extensions.st_numgeometries(v_rings) > 0 then
    -- GR-03(3): a self-touching path yields several rings — keep only the
    -- largest by area and discard the rest.
    select d.geom
      into v_polygon
      from extensions.st_dump(v_rings) as d
     order by extensions.st_area(d.geom::extensions.geography) desc
     limit 1;
  end if;

  -- (a) return-to-start, only when no crossing was found.
  if v_polygon is null then
    if path_length_m < v_min_distance
       or extensions.st_distance(
            v_points[1]::extensions.geography,
            v_points[array_length(v_points, 1)]::extensions.geography
          ) > v_close_radius
    then
      error_code := 'ERR_LOOP_NOT_CLOSED';
      return next;
      return;
    end if;

    -- GR-03(2): force closure by appending the first vertex.
    v_polygon := extensions.st_makepolygon(
      extensions.st_addpoint(v_line_geom, extensions.st_startpoint(v_line_geom))
    );
  end if;

  -- GR-03(3): make valid, then keep the largest ring if it split.
  v_polygon := extensions.st_makevalid(v_polygon);

  if extensions.geometrytype(v_polygon) <> 'POLYGON' then
    select d.geom
      into v_polygon
      from extensions.st_dump(v_polygon) as d
     where extensions.geometrytype(d.geom) = 'POLYGON'
     order by extensions.st_area(d.geom::extensions.geography) desc
     limit 1;
  end if;

  if v_polygon is null or extensions.st_isempty(v_polygon) then
    error_code := 'ERR_LOOP_NOT_CLOSED';
    return next;
    return;
  end if;

  -- GR-03(4): simplify at the configured metre tolerance, converted to degrees
  -- at this latitude. A fixed degree tolerance would mean a different distance
  -- in Lahore than in Oslo. The cos() floor keeps it finite near the poles.
  v_centre_lat   := extensions.st_y(extensions.st_pointonsurface(v_polygon));
  v_simplify_deg := v_simplify_m / (111320 * greatest(cos(radians(v_centre_lat)), 0.01));
  v_simplified   := extensions.st_simplifypreservetopology(v_polygon, v_simplify_deg);

  -- GR-03(5): re-validate, and fall back to the unsimplified polygon if
  -- simplification broke it.
  if v_simplified is not null
     and extensions.st_isvalid(v_simplified)
     and extensions.geometrytype(v_simplified) = 'POLYGON'
     and not extensions.st_isempty(v_simplified)
  then
    v_polygon := v_simplified;
  end if;

  geom        := extensions.st_setsrid(v_polygon, 4326);
  area_m2     := extensions.st_area(geom::extensions.geography);
  perimeter_m := extensions.st_perimeter(geom::extensions.geography);

  -- ── GR-04: validation, in the spec's table order ───────────────────────
  if area_m2 < v_min_area then
    error_code := 'ERR_AREA_TOO_SMALL';
  elsif area_m2 > v_max_area then
    error_code := 'ERR_AREA_TOO_LARGE';
  elsif path_length_m < v_min_distance then
    error_code := 'ERR_DISTANCE_TOO_SHORT';
  elsif duration_s < v_min_duration then
    error_code := 'ERR_DURATION_TOO_SHORT';
  -- GR-05: the isoperimetric ceiling. Uses the WALKED path length, never the
  -- polygon perimeter — a shortcut straight across the polygon would otherwise
  -- shrink the perimeter and inflate the allowance, which is the exact
  -- fabrication this check exists to catch (doc 03 §5 example E).
  elsif area_m2 > (path_length_m ^ 2 / (4 * pi())) * v_iso_tolerance then
    error_code := 'ERR_IMPOSSIBLE_AREA';
  elsif avg_speed_mps > v_max_speed then
    error_code := 'ERR_TOO_FAST';
  end if;

  return next;
end;
$fn$;

comment on function public.build_claim_polygon is
  'GR-01..GR-05. Returns a polygon plus metrics, or an error code. Never raises for '
  'user-caused rejections: doc 03 §6 requires the walk to be saved either way.';
