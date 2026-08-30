-- ═══════════════════════════════════════════════════════════════════════════
-- 0300 · walks, walk_points
--
-- doc 04 §2. `walk_points` is raw evidence kept for anti-cheat auditing only
-- and pruned after 30 days (NFR-09) — that prune is load-bearing, not
-- housekeeping: 10k MAU walking 3×/week is ~78M rows a year.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.walk_status as enum ('active', 'completed', 'abandoned', 'rejected');

create table public.walks (
  id            uuid primary key default extensions.gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  -- FR-20 / NFR-06: the client's own id for the walk, so a retried "start walk"
  -- over a flaky link resumes rather than duplicating.
  client_walk_id uuid,
  status        public.walk_status not null default 'active',
  started_at    timestamptz not null,
  ended_at      timestamptz,
  duration_s    integer,          -- excludes paused time (FR-16)
  distance_m    double precision, -- cleaned path length
  avg_speed_mps double precision,
  max_speed_mps double precision,
  point_count   integer,
  -- Cleaned + simplified. NEVER exposed to anyone but the owner: a polyline is
  -- someone's home address (FR-05, doc 06 §4).
  path          extensions.geometry(LineString, 4326),
  device_meta   jsonb not null default '{}'::jsonb,
  integrity     jsonb not null default '{}'::jsonb,  -- doc 06 §2 signals
  reject_reason text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint walks_ended_after_started check (ended_at is null or ended_at >= started_at),
  constraint walks_duration_nonnegative check (duration_s is null or duration_s >= 0),
  constraint walks_distance_nonnegative check (distance_m is null or distance_m >= 0)
);

comment on table public.walks is
  'One row per recorded walk, claimed or not. doc 03 §6: the exercise is always saved.';
comment on column public.walks.path is
  'Owner-visible only. Exposing this to another user leaks a home address (doc 06 §4.1).';

create index walks_user_started_idx on public.walks (user_id, started_at desc);
create index walks_path_gix on public.walks using gist (path);

-- FR-15 / doc 04: at most one active walk per user. The partial unique index is
-- what makes `409 ACTIVE_WALK_EXISTS` a database guarantee rather than a race.
create unique index one_active_walk_per_user
  on public.walks (user_id) where status = 'active';

-- Lets the client resume by its own id after reinstalling or losing state.
create unique index walks_client_id_idx
  on public.walks (user_id, client_walk_id) where client_walk_id is not null;

create trigger walks_set_updated_at
  before update on public.walks
  for each row execute function public.tg_set_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- walk_points — raw GPS samples
-- ═══════════════════════════════════════════════════════════════════════════

create table public.walk_points (
  walk_id    uuid not null references public.walks(id) on delete cascade,
  seq        integer not null,
  ts         timestamptz not null,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  accuracy_m real,
  speed_mps  real,
  altitude_m real,
  heading    real,
  -- doc 06 §2: collected from the device, never trusted, judged in finish_walk.
  is_mock    boolean not null default false,

  -- doc 05 §2: idempotent on (walk_id, seq) — re-sending a batch on a flaky
  -- network is safe and expected.
  primary key (walk_id, seq)
);

comment on table public.walk_points is
  'Raw samples for anti-cheat auditing. Pruned 30 days after the walk (NFR-09).';

-- The prune job scans by walk; this supports it and the cleaning pass.
create index walk_points_walk_ts_idx on public.walk_points (walk_id, ts);
