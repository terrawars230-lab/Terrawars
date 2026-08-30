-- ═══════════════════════════════════════════════════════════════════════════
-- Post-migration grants.
--
-- Applied AFTER the migrations, before the test suites.
--
-- This reproduces what Supabase does to a fresh project: the `anon` and
-- `authenticated` roles get broad table privileges, and RLS is what actually
-- restricts them. Without this, an RLS test would fail with
-- `insufficient_privilege` because the role has no grant at all — which passes
-- a "the write was blocked" assertion for entirely the wrong reason and would
-- keep passing even if every policy were dropped.
--
-- So: grant generously here, and let the policies do the work. That is the
-- configuration the real anon key runs under, and therefore the only one worth
-- testing against.
-- ═══════════════════════════════════════════════════════════════════════════

-- The roles themselves are created in helpers/00_harness.sql, before the
-- migrations, because the migrations grant to them.

grant usage on schema public     to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

grant all on all tables    in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;

-- Deliberately NOT granted to anon/authenticated:
--   * the `auth` schema — the harness stand-in for Supabase's own.
--   * the `test` schema — fixtures run as the suite owner, never as a client.
grant execute on all functions in schema public to anon, authenticated, service_role;

-- The migrations revoke these individually; re-assert it here so a future
-- `grant all on all functions` above can never quietly hand a client the write
-- path to parcels (CLAUDE.md rule 1).
revoke all on function public.reject_claim(uuid, uuid, text, text)  from anon, authenticated;
revoke all on function public.recompute_user_stats(uuid)            from anon, authenticated;
revoke all on function public.prune_walk_points()                   from anon, authenticated;
revoke all on function public.abandon_stale_walks()                 from anon, authenticated;
revoke all on function public.purge_deleted_accounts()              from anon, authenticated;
revoke all on function public.run_nightly_maintenance()             from anon, authenticated;

-- The suite's own role must be able to switch into the client roles.
do $$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
exception
  when others then
    raise notice 'Could not grant client roles to %; role-switching tests may skip.', current_user;
end;
$$;
