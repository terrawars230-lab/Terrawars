-- ═══════════════════════════════════════════════════════════════════════════
-- 0000 · Extensions and shared helpers
--
-- doc 04: PostgreSQL 15+ with PostGIS 3.4+. All geometry is SRID 4326 (WGS84);
-- every area and distance cast goes through `geography` so results are metres,
-- never degrees (CLAUDE.md rule 9).
--
-- Extensions live in the `extensions` schema, which is the Supabase
-- convention. Every function below therefore pins
-- `search_path = public, extensions` — a SECURITY DEFINER function with a
-- mutable search_path is a privilege-escalation hole.
-- ═══════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;

create extension if not exists postgis      with schema extensions;
create extension if not exists pgcrypto     with schema extensions;
create extension if not exists pg_trgm      with schema extensions;

-- ── Shared trigger helpers ────────────────────────────────────────────────

-- Keeps `updated_at` honest. Attached to every table that has the column.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.tg_set_updated_at is
  'BEFORE UPDATE trigger: stamps updated_at with now().';

-- ── Area formatting helper ────────────────────────────────────────────────

-- doc 03 §4: display areas in km² above 10 000 m², otherwise m², always to
-- three significant figures. Implemented here so leaderboard and stats
-- payloads are formatted identically no matter which function builds them.
create or replace function public.round_sig(p_value numeric, p_digits integer default 3)
returns numeric
language sql
immutable
as $fn$
  select case
    when p_value is null or p_value = 0 then p_value
    else round(p_value, greatest(p_digits - 1 - floor(log(abs(p_value)))::integer, 0))
  end;
$fn$;

comment on function public.round_sig is
  'Rounds to N significant figures. doc 03 §4: never show a user a raw float.';

create or replace function public.format_area(p_area_m2 double precision)
returns text
language sql
immutable
as $fn$
  select case
    when p_area_m2 is null then null
    -- doc 03 §4: km² above 10 000 m², otherwise m², always to 3 sig figs.
    when p_area_m2 >= 10000
      then trim(to_char(public.round_sig((p_area_m2 / 1000000)::numeric, 3), 'FM999990.0999')) || ' km²'
    else trim(to_char(public.round_sig(p_area_m2::numeric, 3), 'FM999990')) || ' m²'
  end;
$fn$;

comment on function public.format_area is
  'doc 03 §4 area display rule: km² above 10 000 m², otherwise m², 3 sig figs.';
