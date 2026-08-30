-- ═══════════════════════════════════════════════════════════════════════════
-- 0100 · game_config
--
-- CLAUDE.md rule 7: tunables come from this table, never from hardcoded
-- literals. doc 07 build-order rule 5 expects to retune these weekly after
-- launch, so every rule function reads them at call time rather than caching.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.game_config (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_at  timestamptz not null default now()
);

comment on table public.game_config is
  'Tunable game constants (doc 03 §1). Read at claim time; never cached in code.';

create trigger game_config_set_updated_at
  before update on public.game_config
  for each row execute function public.tg_set_updated_at();

-- ── Typed accessors ───────────────────────────────────────────────────────
--
-- These raise rather than defaulting when a key is missing. A silently
-- defaulted MIN_CLAIM_AREA_M2 would change the rules of the game without
-- anyone noticing, which is far worse than a failed claim and a loud error.

create or replace function public.config_number(p_key text)
returns double precision
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_value jsonb;
begin
  select value into v_value from public.game_config where key = p_key;

  if v_value is null then
    raise exception 'Missing game_config key: %', p_key
      using errcode = 'P0002', hint = 'Seed it via supabase/seed.sql';
  end if;

  return (v_value #>> '{}')::double precision;
end;
$$;

create or replace function public.config_int(p_key text)
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select public.config_number(p_key)::integer;
$$;

comment on function public.config_number is
  'Reads a numeric game_config value. Raises if the key is absent (rule 7).';
