# 04 — Data Model

PostgreSQL 15+ with PostGIS 3.4+. All geometry is `SRID 4326` (WGS84); all area
and distance math casts to `geography` so results are metres.

```sql
create extension if not exists postgis;
create extension if not exists pgcrypto;
```

---

## 1. Entity overview

```
auth.users (Supabase)
    │ 1:1
profiles ──────────┐
    │ 1:N          │ 1:1
  walks            user_stats
    │ 1:N (raw, pruned at 30d)
  walk_points
    │ 1:0..1
  claims ──────────┬──── 1:N ──── parcels        (current ownership)
                   └──── 1:N ──── steal_events   (history)
```

---

## 2. Tables

### `profiles`

```sql
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  username      text not null unique
                check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name  text,
  avatar_url    text,
  color_hex     text not null default '#3B82F6'
                check (color_hex ~ '^#[0-9A-Fa-f]{6}$'),
  color_changed_at timestamptz,
  home_city     text,
  home_region   text,
  created_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create index on profiles (home_city) where deleted_at is null;
```

### `walks`

```sql
create type walk_status as enum ('active','completed','abandoned','rejected');

create table walks (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references profiles(id) on delete cascade,
  status          walk_status not null default 'active',
  started_at      timestamptz not null,
  ended_at        timestamptz,
  duration_s      integer,          -- excludes paused time
  distance_m      double precision, -- cleaned path length
  avg_speed_mps   double precision,
  max_speed_mps   double precision,
  point_count     integer,
  path            geometry(LineString, 4326),   -- cleaned + simplified
  device_meta     jsonb not null default '{}',  -- model, os, app version
  integrity       jsonb not null default '{}',  -- see doc 06 §3
  reject_reason   text,
  created_at      timestamptz not null default now()
);
create index on walks (user_id, started_at desc);
create index on walks using gist (path);
create index on walks (status) where status = 'active';
```

Constraint: at most one `active` walk per user.

```sql
create unique index one_active_walk_per_user
  on walks (user_id) where status = 'active';
```

### `walk_points`

Raw samples, kept for anti-cheat auditing only, pruned after 30 days (NFR-09).

```sql
create table walk_points (
  walk_id     uuid not null references walks(id) on delete cascade,
  seq         integer not null,
  ts          timestamptz not null,
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  real,
  speed_mps   real,
  altitude_m  real,
  heading     real,
  is_mock     boolean not null default false,
  primary key (walk_id, seq)
);
```

Partition by month if volume demands it. A 45-minute walk at 5 m sampling is
roughly 600 rows — 10k MAU walking 3×/week is ~78M rows/year, so **the 30-day
prune is not optional**, it is load-bearing.

### `claims`

One row per claim attempt, accepted or rejected. This is the audit trail.

```sql
create type claim_status as enum ('accepted','rejected');

create table claims (
  id              uuid primary key default gen_random_uuid(),
  walk_id         uuid not null unique references walks(id) on delete cascade,
  user_id         uuid not null references profiles(id) on delete cascade,
  status          claim_status not null,
  error_code      text,
  geom            geometry(Polygon, 4326),
  raw_area_m2     double precision,   -- area of the claim polygon
  net_area_gain_m2 double precision,  -- after own-parcel merge (GR-21)
  stolen_area_m2  double precision default 0,
  perimeter_m     double precision,
  created_at      timestamptz not null default now()
);
create index on claims (user_id, created_at desc);
create index on claims using gist (geom);
```

`walk_id` being `unique` is the idempotency guarantee for GR-24.

### `parcels` — current ownership

```sql
create table parcels (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references profiles(id) on delete cascade,
  geom             geometry(Polygon, 4326) not null,
  area_m2          double precision not null,
  centroid         geometry(Point, 4326) not null,
  origin_claim_id  uuid references claims(id) on delete set null,
  claimed_at       timestamptz not null default now(),
  protected_until  timestamptz,
  updated_at       timestamptz not null default now(),
  constraint parcel_valid check (st_isvalid(geom)),
  constraint parcel_min_area check (area_m2 >= 100)
);

create index parcels_geom_gix on parcels using gist (geom);
create index parcels_owner_idx on parcels (owner_id);
create index parcels_protected_idx on parcels (protected_until)
  where protected_until is not null;
```

`area_m2` and `centroid` are derived; maintain them with a `before insert or
update` trigger so they can never drift from `geom`.

### `steal_events`

```sql
create table steal_events (
  id           uuid primary key default gen_random_uuid(),
  claim_id     uuid not null references claims(id) on delete cascade,
  attacker_id  uuid not null references profiles(id) on delete cascade,
  victim_id    uuid not null references profiles(id) on delete cascade,
  area_m2      double precision not null,
  geom         geometry(MultiPolygon, 4326),
  created_at   timestamptz not null default now()
);
create index on steal_events (victim_id, created_at desc);
create index on steal_events (attacker_id, created_at desc);
```

### `user_stats` — denormalised score

```sql
create table user_stats (
  user_id            uuid primary key references profiles(id) on delete cascade,
  total_area_m2      double precision not null default 0,
  parcels_count      integer not null default 0,
  total_distance_m   double precision not null default 0,
  walks_count        integer not null default 0,
  claims_count       integer not null default 0,
  area_stolen_m2     double precision not null default 0,
  area_lost_m2       double precision not null default 0,
  steals_made        integer not null default 0,
  best_claim_m2      double precision not null default 0,
  last_walk_at       timestamptz,
  updated_at         timestamptz not null default now()
);
create index on user_stats (total_area_m2 desc);
```

### `weekly_scores`

```sql
create table weekly_scores (
  user_id      uuid not null references profiles(id) on delete cascade,
  iso_year     smallint not null,
  iso_week     smallint not null,
  area_gained_m2 double precision not null default 0,
  distance_m   double precision not null default 0,
  primary key (user_id, iso_year, iso_week)
);
create index on weekly_scores (iso_year, iso_week, area_gained_m2 desc);
```

### `push_tokens`, `game_config`, `moderation_flags`

```sql
create table push_tokens (
  user_id    uuid not null references profiles(id) on delete cascade,
  token      text primary key,
  platform   text not null,
  updated_at timestamptz not null default now()
);

create table game_config (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);

create table moderation_flags (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  walk_id    uuid references walks(id) on delete set null,
  reason     text not null,
  severity   smallint not null default 1,
  resolved   boolean not null default false,
  created_at timestamptz not null default now()
);
```

---

## 3. Core function signatures

Implement these in `supabase/migrations/`. Each gets pgTAP tests.

```sql
-- Cleans points, builds and validates the polygon (GR-01..GR-05).
-- Returns polygon + metrics, or raises with an error code.
create function build_claim_polygon(p_walk_id uuid)
  returns table (geom geometry, area_m2 double precision,
                 perimeter_m double precision, path_length_m double precision);

-- Full atomic resolution (GR-11, GR-20, GR-21). The only write path for parcels.
create function finish_walk(p_walk_id uuid, p_idempotency_key text)
  returns jsonb;   -- { status, claim_id, net_area_gain_m2, stolen: [...], errors }

-- Viewport query for the map (FR-51).
create function parcels_in_bbox(
  p_min_lng double precision, p_min_lat double precision,
  p_max_lng double precision, p_max_lat double precision,
  p_zoom int, p_limit int default 2000)
  returns setof jsonb;   -- GeoJSON features

-- Leaderboards.
create function leaderboard_global(p_limit int, p_offset int) returns setof jsonb;
create function leaderboard_weekly(p_limit int, p_offset int) returns setof jsonb;
create function leaderboard_local(p_city text, p_limit int) returns setof jsonb;
```

`finish_walk` must:
- take an advisory lock on `p_walk_id` to serialise concurrent submissions,
- lock intersecting parcels `FOR UPDATE ORDER BY id`,
- do all work in one transaction,
- return a structured result rather than raising, for anything the user caused.

---

## 4. Simplification for map delivery

Never send full-resolution geometry to a zoomed-out client. In
`parcels_in_bbox`, simplify by zoom:

| Zoom | Tolerance | Behaviour |
|---|---|---|
| ≥ 16 | 0 m | full geometry |
| 14–15 | 5 m | simplified |
| 12–13 | 20 m | simplified, drop parcels < 1000 m² |
| < 12 | — | return aggregated counts/centroids only, no polygons |

Use `ST_SimplifyPreserveTopology` and `ST_AsGeoJSON`. Consider serving vector
tiles via `ST_AsMVT` once parcel counts pass ~50k — the interface stays the same.

---

## 5. Retention & pruning

A scheduled job (pg_cron or a Supabase scheduled Edge Function) runs nightly:

- delete `walk_points` where the parent walk ended > 30 days ago (NFR-09),
- mark `walks` still `active` after 6 hours as `abandoned`,
- roll up the previous ISO week into `weekly_scores` and cache leaderboard tops.

---

## 6. Row-level security

RLS is on for every table. The client uses only the anon key, so these policies
are the actual security boundary.

| Table | Read | Write |
|---|---|---|
| `profiles` | anyone authenticated (public fields) | own row only |
| `walks` | own rows only | own rows, insert/update only while `active` |
| `walk_points` | own rows only | insert own only |
| `claims` | own rows only | **none** — written only by `finish_walk` |
| `parcels` | anyone authenticated (geometry + owner id + area + protection) | **none from client** |
| `steal_events` | rows where you are attacker or victim | none |
| `user_stats` | anyone authenticated | none |
| `push_tokens` | own | own |
| `game_config` | anyone authenticated | none |

`finish_walk` is `SECURITY DEFINER` and is the sole path that mutates `parcels`,
`claims`, `steal_events` and `user_stats`. **A client must never be able to
insert a parcel.** If it can, the game is over on day one.

Never expose a walk's `path` or `walk_points` to anyone but the owner — that is
someone's home address in a polyline (FR-05, doc 06 § 4).
