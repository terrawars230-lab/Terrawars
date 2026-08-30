-- ═══════════════════════════════════════════════════════════════════════════
-- 0400 · claims, parcels, steal_events
--
-- doc 04 §2 / GR-10: ownership is stored as parcels — one row per contiguous
-- polygon. Never one giant per-user MULTIPOLYGON, which would make every
-- viewport query touch every user.
-- ═══════════════════════════════════════════════════════════════════════════

create type public.claim_status as enum ('accepted', 'rejected');

create table public.claims (
  id               uuid primary key default extensions.gen_random_uuid(),
  -- GR-24 / NFR-06: UNIQUE is the idempotency guarantee. A walk is claimable
  -- exactly once, enforced by the database rather than by application logic.
  walk_id          uuid not null unique references public.walks(id) on delete cascade,
  user_id          uuid not null references public.profiles(id) on delete cascade,
  status           public.claim_status not null,
  error_code       text,
  geom             extensions.geometry(Polygon, 4326),
  raw_area_m2      double precision,
  -- GR-21: after the own-parcel merge. Re-walking the same loop yields ~0.
  net_area_gain_m2 double precision,
  stolen_area_m2   double precision not null default 0,
  perimeter_m      double precision,
  idempotency_key  text,
  created_at       timestamptz not null default now(),

  constraint claims_rejected_has_code
    check (status <> 'rejected' or error_code is not null),
  constraint claims_accepted_has_geom
    check (status <> 'accepted' or geom is not null)
);

comment on table public.claims is
  'Audit trail of every claim attempt, accepted or rejected. Written only by finish_walk.';
comment on column public.claims.walk_id is
  'GR-24 idempotency: UNIQUE means a walk can be claimed exactly once.';

create index claims_user_created_idx on public.claims (user_id, created_at desc);
create index claims_geom_gix on public.claims using gist (geom);

-- ═══════════════════════════════════════════════════════════════════════════
-- parcels — current ownership (GR-10)
-- ═══════════════════════════════════════════════════════════════════════════

create table public.parcels (
  id              uuid primary key default extensions.gen_random_uuid(),
  owner_id        uuid not null references public.profiles(id) on delete cascade,
  geom            extensions.geometry(Polygon, 4326) not null,
  -- Derived from geom by trigger, so they can never drift (doc 04 §2).
  area_m2         double precision not null,
  centroid        extensions.geometry(Point, 4326) not null,
  origin_claim_id uuid references public.claims(id) on delete set null,
  claimed_at      timestamptz not null default now(),
  -- GR-23: claimed_at + PROTECTION_HOURS. Null means never protected.
  protected_until timestamptz,
  updated_at      timestamptz not null default now(),

  constraint parcel_valid check (extensions.st_isvalid(geom)),
  -- GR-20 sliver rule. The literal mirrors the MIN_PARCEL_AREA_M2 default; the
  -- authoritative value is read from game_config inside finish_walk, and this
  -- constraint is the backstop that keeps a sliver out of the table if the
  -- function is ever wrong.
  constraint parcel_min_area check (area_m2 >= 100)
);

comment on table public.parcels is
  'Current ownership, one row per contiguous polygon (GR-10). Written only by finish_walk.';

create index parcels_geom_gix on public.parcels using gist (geom);
create index parcels_owner_idx on public.parcels (owner_id);
create index parcels_protected_idx on public.parcels (protected_until)
  where protected_until is not null;
-- Supports the zoom-based viewport query at low zoom (doc 04 §4).
create index parcels_centroid_gix on public.parcels using gist (centroid);

-- Derived columns maintained by trigger, never by the caller. GR-10 depends on
-- area_m2 being exactly ST_Area(geom::geography) for scoring to be correct.
create or replace function public.tg_parcel_derive_geometry()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.geom     := extensions.st_makevalid(new.geom);
  new.area_m2  := extensions.st_area(new.geom::extensions.geography);
  new.centroid := extensions.st_pointonsurface(new.geom);
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.tg_parcel_derive_geometry is
  'Keeps area_m2 and centroid in lockstep with geom. ST_PointOnSurface, not '
  'ST_Centroid: a centroid can fall outside a concave parcel, which would put '
  'the map marker on someone else''s land.';

create trigger parcels_derive_geometry
  before insert or update of geom on public.parcels
  for each row execute function public.tg_parcel_derive_geometry();

-- ═══════════════════════════════════════════════════════════════════════════
-- steal_events — raid history (FR-44)
-- ═══════════════════════════════════════════════════════════════════════════

create table public.steal_events (
  id          uuid primary key default extensions.gen_random_uuid(),
  claim_id    uuid not null references public.claims(id) on delete cascade,
  attacker_id uuid not null references public.profiles(id) on delete cascade,
  victim_id   uuid not null references public.profiles(id) on delete cascade,
  area_m2     double precision not null check (area_m2 > 0),
  geom        extensions.geometry(MultiPolygon, 4326),
  created_at  timestamptz not null default now(),

  -- FR-43: a user cannot steal from themselves; overlaps merge instead.
  constraint steal_not_self check (attacker_id <> victim_id)
);

comment on table public.steal_events is
  'One row per victim per claim (GR-11 step 7). Drives push (FR-42) and history (FR-44).';

create index steal_events_victim_idx on public.steal_events (victim_id, created_at desc);
create index steal_events_attacker_idx on public.steal_events (attacker_id, created_at desc);
create index steal_events_claim_idx on public.steal_events (claim_id);
