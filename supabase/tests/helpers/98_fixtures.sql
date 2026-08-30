-- ════════════════════════════════════════════════════════════════════════════
-- Geometry fixtures.
--
-- Loaded AFTER the migrations: every function here is typed against
-- `extensions.geometry`, and PostGIS is not installed until migration 0000
-- creates it. Loading this with the rest of the harness fails with
-- `type "extensions.geometry" does not exist`.
--
-- Anchored near Lahore (31.52 N), the OQ-3 launch city, so the
-- latitude-dependent metre/degree conversions are exercised at a realistic
-- value rather than at the equator where they are degenerate.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function test.origin_lat() returns double precision
  language sql immutable as $$ select 31.5204::double precision $$;
create or replace function test.origin_lng() returns double precision
  language sql immutable as $$ select 74.3587::double precision $$;

/** A point `p_east_m` east and `p_north_m` north of the fixture origin. */
create or replace function test.offset_point(p_east_m double precision, p_north_m double precision)
returns extensions.geometry
language sql
immutable
set search_path = public, extensions
as $$
  select extensions.st_point(
    test.origin_lng() + p_east_m / (111320 * cos(radians(test.origin_lat()))),
    test.origin_lat() + p_north_m / 111320,
    4326
  );
$$;

/** An axis-aligned square of the given side, as a polygon. */
create or replace function test.square(
  p_side_m double precision,
  p_east_m double precision default 0,
  p_north_m double precision default 0
)
returns extensions.geometry
language sql
immutable
set search_path = public, extensions
as $$
  select extensions.st_makepolygon(extensions.st_makeline(array[
    test.offset_point(p_east_m,             p_north_m),
    test.offset_point(p_east_m + p_side_m,  p_north_m),
    test.offset_point(p_east_m + p_side_m,  p_north_m + p_side_m),
    test.offset_point(p_east_m,             p_north_m + p_side_m),
    test.offset_point(p_east_m,             p_north_m)
  ]));
$$;

/**
 * Inserts a walk plus the GPS points tracing a square loop.
 *
 * `p_interval_s` controls the implied speed, which is how a test reaches the
 * GR-04 speed and duration checks. Points are spaced along each edge so the
 * result survives GR-01's 2 m jitter filter and clears MIN_POINTS.
 */
create or replace function test.record_square_walk(
  p_user_id     uuid,
  p_side_m      double precision,
  p_east_m      double precision default 0,
  p_north_m     double precision default 0,
  p_interval_s  double precision default 10,
  p_per_edge    integer default 12
)
returns uuid
language plpgsql
set search_path = public, extensions
as $$
declare
  v_walk_id uuid;
  v_seq     integer := 0;
  v_edge    integer;
  v_step    integer;
  v_t       double precision;
  v_east    double precision;
  v_north   double precision;
  v_pt      extensions.geometry;
  v_started timestamptz := now() - interval '1 hour';
begin
  insert into public.walks (user_id, started_at)
  values (p_user_id, v_started)
  returning id into v_walk_id;

  for v_edge in 0..3 loop
    for v_step in 0..(p_per_edge - 1) loop
      v_t := v_step::double precision / p_per_edge;

      -- Walk the perimeter anticlockwise: E, N, W, S.
      if v_edge = 0 then
        v_east := p_east_m + p_side_m * v_t;  v_north := p_north_m;
      elsif v_edge = 1 then
        v_east := p_east_m + p_side_m;        v_north := p_north_m + p_side_m * v_t;
      elsif v_edge = 2 then
        v_east := p_east_m + p_side_m * (1 - v_t); v_north := p_north_m + p_side_m;
      else
        v_east := p_east_m;                   v_north := p_north_m + p_side_m * (1 - v_t);
      end if;

      v_pt := test.offset_point(v_east, v_north);

      insert into public.walk_points (walk_id, seq, ts, lat, lng, accuracy_m, is_mock)
      values (
        v_walk_id, v_seq,
        v_started + (v_seq * p_interval_s) * interval '1 second',
        extensions.st_y(v_pt), extensions.st_x(v_pt), 8, false
      );
      v_seq := v_seq + 1;
    end loop;
  end loop;

  -- Close the loop by returning to the start (GR-02(a)).
  v_pt := test.offset_point(p_east_m, p_north_m);
  insert into public.walk_points (walk_id, seq, ts, lat, lng, accuracy_m, is_mock)
  values (
    v_walk_id, v_seq,
    v_started + (v_seq * p_interval_s) * interval '1 second',
    extensions.st_y(v_pt), extensions.st_x(v_pt), 8, false
  );

  return v_walk_id;
end;
$$;

/** Awards a parcel directly, bypassing finish_walk, to set up a rival's land. */
create or replace function test.give_parcel(
  p_owner_id        uuid,
  p_geom            extensions.geometry,
  p_protected_until timestamptz default null,
  p_claimed_at      timestamptz default now()
)
returns uuid
language sql
set search_path = public, extensions
as $$
  insert into public.parcels (owner_id, geom, claimed_at, protected_until)
  values (p_owner_id, p_geom, p_claimed_at, p_protected_until)
  returning id;
$$;
