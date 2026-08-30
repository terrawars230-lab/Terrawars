-- ═══════════════════════════════════════════════════════════════════════════
-- Test harness
--
-- Loaded BEFORE the migrations. Two jobs:
--
--  1. Stand up a minimal `auth` schema, so the migrations — which reference
--     `auth.users` and `auth.uid()` — can run against a plain PostGIS image
--     instead of requiring a full Supabase instance.
--  2. Provide assertion helpers.
--
-- On assertions: doc 07 asks for pgTAP. This uses plain SQL that RAISEs on
-- failure instead, because pgTAP is not present in the standard postgis image
-- and installing it inside a CI service container is awkward. The trade is
-- prettier output for the ability to run this suite anywhere — including
-- against a real Supabase project — with nothing but psql. Every assertion
-- still fails loudly and names the rule it was checking.
--
-- ⚠️ NEVER run this file against production. It replaces auth.uid().
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Minimal stand-in for Supabase's auth.users. Only the columns the migrations
-- actually touch.
create table if not exists auth.users (
  id                 uuid primary key default extensions.gen_random_uuid(),
  instance_id        uuid,
  aud                text,
  role               text,
  email              text unique,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  raw_app_meta_data  jsonb not null default '{}'::jsonb,
  raw_user_meta_data jsonb not null default '{}'::jsonb
);

-- Supabase derives auth.uid() from the request JWT. In tests it reads a GUC the
-- suite sets, so a test can act as a specific player.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('terrawars.test_user_id', true), '')::uuid;
$$;

-- ── Test-session helpers ──────────────────────────────────────────────────

create schema if not exists test;

/** Acts as this user for subsequent statements. NULL means signed out. */
create or replace function test.act_as(p_user_id uuid)
returns void
language sql
as $$
  select set_config('terrawars.test_user_id', coalesce(p_user_id::text, ''), false);
$$;

/** Creates an auth user + profile + stats, exactly as a real signup would. */
create or replace function test.create_player(p_username text)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := extensions.gen_random_uuid();
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_id, p_username || '@example.test', jsonb_build_object('username', p_username));
  -- profiles and user_stats are created by the on_auth_user_created trigger.
  return v_id;
end;
$$;

-- ── Assertions ────────────────────────────────────────────────────────────

create or replace function test.fail(p_message text)
returns void
language plpgsql
as $$
begin
  raise exception 'ASSERTION FAILED: %', p_message using errcode = 'triggered_action_exception';
end;
$$;

create or replace function test.ok(p_condition boolean, p_message text)
returns void
language plpgsql
as $$
begin
  if p_condition is null or not p_condition then
    perform test.fail(p_message);
  end if;
  raise notice '  ok: %', p_message;
end;
$$;

create or replace function test.eq(p_actual anyelement, p_expected anyelement, p_message text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    perform test.fail(format('%s (expected %L, got %L)', p_message, p_expected, p_actual));
  end if;
  raise notice '  ok: %', p_message;
end;
$$;

/** Asserts two numbers agree within a tolerance — for geodesic areas. */
create or replace function test.near(
  p_actual double precision,
  p_expected double precision,
  p_tolerance double precision,
  p_message text
)
returns void
language plpgsql
as $$
begin
  if p_actual is null or abs(p_actual - p_expected) > p_tolerance then
    perform test.fail(format('%s (expected %s +/- %s, got %s)',
                             p_message, p_expected, p_tolerance, p_actual));
  end if;
  raise notice '  ok: % (%)', p_message, round(p_actual::numeric, 1);
end;
$$;

create or replace function test.section(p_name text)
returns void
language plpgsql
as $$
begin
  raise notice E'\n== %', p_name;
end;
$$;

-- ── Geometry fixtures ─────────────────────────────────────────────────────
--
-- Anchored near Lahore (31.52 N), the OQ-3 launch city, so the
-- latitude-dependent metre/degree conversions are exercised at a realistic
-- value rather than at the equator where they are degenerate.

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
