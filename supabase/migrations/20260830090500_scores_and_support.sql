-- ═══════════════════════════════════════════════════════════════════════════
-- 0500 · weekly_scores, push_tokens, moderation_flags
-- ═══════════════════════════════════════════════════════════════════════════

-- FR-61: weekly board by area *gained*, resetting Monday 00:00 UTC. Keyed by
-- ISO year+week so the Monday boundary is the database's definition of the
-- week, not the client's timezone.
create table public.weekly_scores (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  iso_year       smallint not null,
  iso_week       smallint not null check (iso_week between 1 and 53),
  -- Can go negative: doc 03 §4 says being raided counts against you.
  area_gained_m2 double precision not null default 0,
  distance_m     double precision not null default 0,
  updated_at     timestamptz not null default now(),
  primary key (user_id, iso_year, iso_week)
);

comment on table public.weekly_scores is
  'FR-61 weekly leaderboard source. area_gained_m2 may be negative after a raid.';

create index weekly_scores_leaderboard_idx
  on public.weekly_scores (iso_year, iso_week, area_gained_m2 desc);

create trigger weekly_scores_set_updated_at
  before update on public.weekly_scores
  for each row execute function public.tg_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- push_tokens (FR-42, FR-70)
-- ═══════════════════════════════════════════════════════════════════════════

create table public.push_tokens (
  token      text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  platform   text not null check (platform in ('android', 'ios')),
  -- FR-72: every non-essential notification is individually toggleable.
  prefs      jsonb not null default '{"territory_stolen": true, "weekly_result": false}'::jsonb,
  updated_at timestamptz not null default now()
);

create index push_tokens_user_idx on public.push_tokens (user_id);

create trigger push_tokens_set_updated_at
  before update on public.push_tokens
  for each row execute function public.tg_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- moderation_flags (doc 06 §3)
--
-- doc 06: build this before public launch. Retrofitting anti-cheat after a
-- leaderboard is poisoned means resetting everyone's score, which costs more
-- users than the cheating did.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.moderation_flags (
  id         uuid primary key default extensions.gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  walk_id    uuid references public.walks(id) on delete set null,
  -- One of the doc 06 §3 soft-flag names: LOW_STEPS, TOO_SMOOTH,
  -- PERFECT_GEOMETRY, NO_ALTITUDE_VARIANCE, ROOTED_DEVICE, IMPOSSIBLE_JUMP,
  -- DUPLICATE_ROUTE, MULTI_ACCOUNT.
  reason     text not null,
  severity   smallint not null default 1 check (severity between 1 and 5),
  details    jsonb not null default '{}'::jsonb,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.moderation_flags is
  'doc 06 §3 soft flags. Never readable by the client — do not teach cheaters which check caught them.';

create index moderation_flags_user_idx on public.moderation_flags (user_id, created_at desc)
  where not resolved;

-- ═══════════════════════════════════════════════════════════════════════════
-- Leaderboard eligibility
--
-- doc 06 §3 escalation: a user under review still plays and still sees their
-- own rank, but disappears from public boards — with no error and no
-- explanation, deliberately.
-- ═══════════════════════════════════════════════════════════════════════════

create or replace function public.is_leaderboard_eligible(p_profile public.profiles)
returns boolean
language sql
immutable
as $$
  select p_profile.deleted_at is null
     and not p_profile.is_under_review
     and not p_profile.is_shadow_suspended;
$$;
