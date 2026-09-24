-- ═══════════════════════════════════════════════════════════════════════════
-- 20260922120000 · walks: column-level grants, and a narrower update policy
--
-- The same hole 20260904120000 closed on `profiles`, on the table that holds
-- the evidence for every claim. `walks_insert_own` and
-- `walks_update_own_active` are ROW policies: they decide which walk a client
-- may touch, not which columns. Under Supabase's default table grants that let
-- a client:
--
--   * write `integrity` — the doc 06 §2 anti-cheat signals — on its own walk,
--     at insert or at any point while it is active;
--   * write `distance_m`, `duration_s`, `avg_speed_mps`, `point_count`, `path`
--     and `reject_reason`, which only finish_walk may set;
--   * move its walk straight to `completed` or `rejected` from the client,
--     bypassing finish_walk's bookkeeping (doc 03 §6).
--
-- finish_walk re-derives everything it judges from walk_points, so none of
-- this changes a verdict today. It is closed anyway because doc 06 §1 is
-- explicit that the client is never trusted, and the next feature to read one
-- of these columns should not inherit a writable one.
--
-- What the client legitimately does, and all it is now granted:
--   INSERT (user_id, client_walk_id, started_at, device_meta)   — startWalk()
--   UPDATE (status, ended_at), active → abandoned only          — abandonWalk()
-- finish_walk and the maintenance jobs are SECURITY DEFINER and unaffected.
-- ═══════════════════════════════════════════════════════════════════════════

revoke insert, update on public.walks from anon, authenticated;

grant insert (user_id, client_walk_id, started_at, device_meta)
  on public.walks to authenticated;

grant update (status, ended_at)
  on public.walks to authenticated;

-- FR-17: the only transition a client makes is abandoning its own active walk.
-- The USING clause already limits the rows to active ones; the new WITH CHECK
-- limits where they can go.
drop policy if exists walks_update_own_active on public.walks;

create policy walks_update_own_active
  on public.walks for update
  to authenticated
  using (user_id = (select auth.uid()) and status = 'active')
  with check (user_id = (select auth.uid()) and status in ('active', 'abandoned'));

comment on policy walks_update_own_active on public.walks is
  'FR-17: a client may abandon its own active walk. Every other status is set by finish_walk.';
