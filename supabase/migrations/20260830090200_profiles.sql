-- ═══════════════════════════════════════════════════════════════════════════
-- 0200 · profiles, user_stats
--
-- doc 04 §2. A profile row is created by trigger the moment auth.users gains a
-- row, so the app never has to handle a signed-in user with no profile.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.profiles (
  id               uuid primary key references auth.users(id) on delete cascade,
  -- FR-02: 3–20 chars, lowercase alphanumeric + underscore, public.
  username         text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name     text check (char_length(display_name) <= 40),
  avatar_url       text,
  -- FR-03: territory colour, changeable once per 30 days.
  color_hex        text not null default '#3B82F6' check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  color_changed_at timestamptz,
  home_city        text,
  home_region      text,
  -- doc 06 §3: escalation states. Neither is ever disclosed to the user.
  is_under_review  boolean not null default false,
  is_shadow_suspended boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- FR-06: soft delete now, hard delete after a 7-day grace period.
  deleted_at       timestamptz
);

comment on table public.profiles is
  'Public player identity. Never contains PII beyond a self-chosen username.';
comment on column public.profiles.is_shadow_suspended is
  'doc 06 §3: walks record, claims silently do not apply. Never surfaced to the client.';

create index profiles_home_city_idx on public.profiles (home_city) where deleted_at is null;
create index profiles_username_trgm_idx on public.profiles using gin (username extensions.gin_trgm_ops);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.tg_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- user_stats — denormalised score (doc 03 §4)
--
-- Updated inside the claim transaction, never computed on read. Leaderboards
-- read this table directly; NFR-04 does not survive a SUM over parcels.
-- ═══════════════════════════════════════════════════════════════════════════

create table public.user_stats (
  user_id          uuid primary key references public.profiles(id) on delete cascade,
  total_area_m2    double precision not null default 0,
  parcels_count    integer not null default 0,
  total_distance_m double precision not null default 0,
  walks_count      integer not null default 0,
  claims_count     integer not null default 0,
  area_stolen_m2   double precision not null default 0,
  area_lost_m2     double precision not null default 0,
  steals_made      integer not null default 0,
  best_claim_m2    double precision not null default 0,
  last_walk_at     timestamptz,
  updated_at       timestamptz not null default now()
);

comment on table public.user_stats is
  'Denormalised score, maintained inside finish_walk. Never recomputed on read.';

-- The leaderboard index (FR-60). Partial on > 0 so the long tail of users who
-- have never claimed does not bloat it.
create index user_stats_total_area_idx on public.user_stats (total_area_m2 desc)
  where total_area_m2 > 0;

create trigger user_stats_set_updated_at
  before update on public.user_stats
  for each row execute function public.tg_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- Signup: create profile + stats atomically with the auth user
-- ═══════════════════════════════════════════════════════════════════════════

-- FR-03: assign a territory colour at signup. Deterministic from the user id
-- so the same account always gets the same starting colour, and the palette is
-- chosen to stay distinguishable against map tiles and against each other.
create or replace function public.assign_signup_color(p_user_id uuid)
returns text
language sql
immutable
as $$
  select (array[
    '#3B82F6', -- blue
    '#EF4444', -- red
    '#10B981', -- emerald
    '#F59E0B', -- amber
    '#8B5CF6', -- violet
    '#EC4899', -- pink
    '#14B8A6', -- teal
    '#F97316', -- orange
    '#6366F1', -- indigo
    '#84CC16'  -- lime
  ])[1 + (('x' || substr(md5(p_user_id::text), 1, 8))::bit(32)::bigint % 10)];
$$;

create or replace function public.tg_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_username text;
begin
  -- A provisional username so the row is always valid. FR-02 makes the user
  -- choose a real one on first launch; the app treats a `user_`-prefixed
  -- username as "not yet chosen".
  v_username := coalesce(
    nullif(lower(new.raw_user_meta_data ->> 'username'), ''),
    'user_' || substr(replace(new.id::text, '-', ''), 1, 12)
  );

  insert into public.profiles (id, username, display_name, avatar_url, color_hex)
  values (
    new.id,
    v_username,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'avatar_url', ''),
    public.assign_signup_color(new.id)
  )
  on conflict (id) do nothing;

  insert into public.user_stats (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.tg_handle_new_user();

comment on function public.tg_handle_new_user is
  'Creates profiles + user_stats rows with the auth user so no signed-in user is ever profile-less.';

-- ═══════════════════════════════════════════════════════════════════════════
-- Username availability (FR-02, live check)
-- ═══════════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so the check works without exposing the profiles table to
-- enumeration: it answers one yes/no question and returns nothing else.
create or replace function public.is_username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select p_username ~ '^[a-z0-9_]{3,20}$'
     and not exists (select 1 from public.profiles where username = p_username);
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to authenticated;
