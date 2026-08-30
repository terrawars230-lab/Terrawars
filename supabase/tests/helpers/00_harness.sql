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
-- Geometry fixtures live in helpers/98_fixtures.sql instead, because they use
-- `extensions.geometry` and PostGIS is not installed until the migrations run.
--
-- ⚠️ NEVER run this file against production. It replaces auth.uid().
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists auth;
create schema if not exists extensions;

-- Relocate PostGIS into `extensions`.
--
-- The postgis/postgis Docker image pre-installs PostGIS into `public`. Supabase
-- puts it in `extensions`, and every migration and function here is written
-- against `extensions.geometry` — so on the CI image, migration 0000's
-- `create extension if not exists postgis with schema extensions` finds it
-- already present, skips, and leaves it in `public`. The next migration then
-- fails with `type "extensions.geometry" does not exist`.
--
-- PostGIS is not relocatable, so ALTER EXTENSION ... SET SCHEMA will not move
-- it; it has to be dropped and recreated. Safe here and nowhere else: the
-- harness only ever runs against an empty, disposable database, and run.sh
-- refuses to point at a hosted project.
do $postgis$
begin
  if exists (
    select 1
      from pg_extension e
      join pg_namespace n on n.oid = e.extnamespace
     where e.extname = 'postgis' and n.nspname <> 'extensions'
  ) then
    drop extension if exists postgis_tiger_geocoder cascade;
    drop extension if exists postgis_topology cascade;
    drop extension if exists postgis cascade;
  end if;
end;
$postgis$;

create extension if not exists postgis  with schema extensions;
create extension if not exists pgcrypto with schema extensions;

-- The client roles must exist BEFORE the migrations run: 0200_profiles.sql
-- grants execute on is_username_available to `authenticated`, and a bare
-- Postgres has no such role. A real Supabase project pre-creates all three, so
-- this is filling a harness gap, not working around a migration bug.
-- helpers/99_grants.sql grants them table privileges once the tables exist.
do $roles$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$roles$;

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
