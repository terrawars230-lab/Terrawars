-- ═══════════════════════════════════════════════════════════════════════════
-- 0600 · Row-level security
--
-- doc 04 §6: the client holds only the anon key, so these policies ARE the
-- security boundary. Two rules dominate everything below:
--
--   1. A client must never be able to insert a parcel. If it can, the game is
--      over on day one. `finish_walk` is the sole write path (CLAUDE.md rule 1).
--   2. A walk's `path` and its `walk_points` are never visible to anyone but
--      the owner. That polyline is someone's home address (FR-05, doc 06 §4).
--
-- RLS is enabled on every table. Tables with no write policy are read-only to
-- the client by construction — "no policy" means "deny", so the absence of an
-- INSERT policy on `parcels` is the enforcement, not an oversight.
-- ═══════════════════════════════════════════════════════════════════════════

alter table public.profiles         enable row level security;
alter table public.user_stats       enable row level security;
alter table public.walks            enable row level security;
alter table public.walk_points      enable row level security;
alter table public.claims           enable row level security;
alter table public.parcels          enable row level security;
alter table public.steal_events     enable row level security;
alter table public.weekly_scores    enable row level security;
alter table public.push_tokens      enable row level security;
alter table public.game_config      enable row level security;
alter table public.moderation_flags enable row level security;

-- ── profiles ──────────────────────────────────────────────────────────────
-- Public fields readable by any authenticated user (FR-05); writable only by
-- their owner.

-- `using (true)`, not `deleted_at is null`: parcels join to profiles for their
-- owner label, so hiding a soft-deleted profile would punch a hole in the world
-- map for the whole 7-day grace period. The row is already anonymised at
-- deletion time (doc 06 §5), and get_public_profile filters deleted users out
-- of profile lookups.
create policy profiles_select_authenticated
  on public.profiles for select
  to authenticated
  using (true);

create policy profiles_update_own
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- No INSERT policy: rows are created by the on_auth_user_created trigger.
-- No DELETE policy: FR-06 deletion goes through the request_account_deletion
-- RPC so parcels can be reassigned rather than cascade-deleted (doc 06 §5).

-- ── user_stats ────────────────────────────────────────────────────────────
-- Readable by anyone authenticated (leaderboards, public profiles). Written
-- only by finish_walk.

create policy user_stats_select_authenticated
  on public.user_stats for select
  to authenticated
  using (true);

-- ── walks ─────────────────────────────────────────────────────────────────
-- Own rows only, in both directions.

create policy walks_select_own
  on public.walks for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy walks_insert_own
  on public.walks for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- Updatable only while active. Once a walk is completed or rejected it is
-- evidence, and a client that could rewrite `path` or `distance_m` after the
-- fact could rewrite the outcome of its own claim.
create policy walks_update_own_active
  on public.walks for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()));

-- ── walk_points ───────────────────────────────────────────────────────────
-- Insert-only, own walks, while the walk is still active.

create policy walk_points_select_own
  on public.walk_points for select
  to authenticated
  using (
    exists (
      select 1 from public.walks w
      where w.id = walk_points.walk_id and w.user_id = (select auth.uid())
    )
  );

create policy walk_points_insert_own_active
  on public.walk_points for insert
  to authenticated
  with check (
    exists (
      select 1 from public.walks w
      where w.id = walk_points.walk_id
        and w.user_id = (select auth.uid())
        and w.status = 'active'
    )
  );

-- No UPDATE or DELETE policy: a point, once uploaded, is immutable evidence.

-- ── claims ────────────────────────────────────────────────────────────────
-- Own rows readable. No write policy at all — finish_walk is the only writer.

create policy claims_select_own
  on public.claims for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ── parcels ───────────────────────────────────────────────────────────────
-- Readable by anyone authenticated: the world map is the product (FR-50).
-- NO write policy of any kind. This is the single most important line in the
-- schema.

create policy parcels_select_authenticated
  on public.parcels for select
  to authenticated
  using (true);

-- ── steal_events ──────────────────────────────────────────────────────────
-- Visible to the two players involved (FR-44), nobody else.

create policy steal_events_select_participant
  on public.steal_events for select
  to authenticated
  using (
    attacker_id = (select auth.uid()) or victim_id = (select auth.uid())
  );

-- ── weekly_scores ─────────────────────────────────────────────────────────

create policy weekly_scores_select_authenticated
  on public.weekly_scores for select
  to authenticated
  using (true);

-- ── push_tokens ───────────────────────────────────────────────────────────
-- Own rows, full control: registering and revoking a device is the client's job.

create policy push_tokens_all_own
  on public.push_tokens for all
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ── game_config ───────────────────────────────────────────────────────────
-- Readable so the client can mirror the tunables for its advisory preview
-- (CLAUDE.md rule 7). Never writable.

create policy game_config_select_authenticated
  on public.game_config for select
  to authenticated
  using (true);

-- ── moderation_flags ──────────────────────────────────────────────────────
-- No policy at all. doc 06 §3: do not tell cheaters which check caught them.
-- Reachable only by the service role, from the internal admin view.

-- ═══════════════════════════════════════════════════════════════════════════
-- On the walk path
--
-- There is deliberately NO public view over `walks`. doc 05 §5 defines no
-- public walk endpoint, and FR-05 / doc 06 §4.1 are explicit that a route
-- polyline is someone's home address. `walks` is own-rows-only above, and that
-- is the whole of the exposure surface. Any future public profile feature must
-- read `user_stats`, never `walks`.
-- ═══════════════════════════════════════════════════════════════════════════
