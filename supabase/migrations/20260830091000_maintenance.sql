-- ═══════════════════════════════════════════════════════════════════════════
-- 1000 · Retention and maintenance (doc 04 §5)
--
-- A nightly job. The 30-day walk_points prune is NOT housekeeping — at 10k MAU
-- walking three times a week it is ~78M rows a year, and NFR-09 requires the
-- deletion regardless of volume.
--
-- Scheduling: enable pg_cron in the Supabase dashboard (Database → Extensions)
-- and run `select public.schedule_maintenance();` once per project. It is kept
-- as an explicit call rather than a migration side effect, because pg_cron is
-- not available on every plan and a migration that fails on a missing extension
-- blocks every later migration.
-- ═══════════════════════════════════════════════════════════════════════════

-- NFR-09: raw GPS points are deleted 30 days after the walk. Derived geometry
-- (the parcel) persists; the evidence trail does not.
create or replace function public.prune_walk_points()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_deleted integer;
begin
  with doomed as (
    delete from public.walk_points wp
     using public.walks w
     where wp.walk_id = w.id
       and w.ended_at is not null
       and w.ended_at < now() - interval '30 days'
    returning 1
  )
  select count(*)::integer into v_deleted from doomed;

  return v_deleted;
end;
$fn$;

-- doc 04 §5: a walk left active for six hours is not a walk any more. FR-19
-- caps a walk at four hours, so six is a generous margin for a client that
-- died mid-route without reporting.
create or replace function public.abandon_stale_walks()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_count integer;
begin
  with stale as (
    update public.walks
       set status = 'abandoned',
           ended_at = coalesce(ended_at, started_at + interval '6 hours')
     where status = 'active'
       and started_at < now() - interval '6 hours'
    returning 1
  )
  select count(*)::integer into v_count from stale;

  return v_count;
end;
$fn$;

-- FR-06 / doc 06 §5: hard-delete after the 7-day grace period.
--
-- Parcels are reassigned rather than deleted, so the map does not develop holes
-- and other players' steal history stays coherent. The land remains claimable
-- normally.
create or replace function public.purge_deleted_accounts()
returns integer
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_tombstone uuid;
  v_count integer := 0;
  v_user record;
begin
  -- A single system-owned profile that inherits abandoned land.
  select id into v_tombstone from public.profiles where username = 'deleted_player';

  if v_tombstone is null then
    return 0;
  end if;

  for v_user in
    select id from public.profiles
     where deleted_at is not null
       and deleted_at < now() - interval '7 days'
       and id <> v_tombstone
  loop
    update public.parcels set owner_id = v_tombstone where owner_id = v_user.id;
    perform public.recompute_user_stats(v_tombstone);

    -- Removing the auth user cascades to profiles, walks, claims and stats.
    delete from auth.users where id = v_user.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

-- Convenience wrapper so the schedule has a single entry point.
create or replace function public.run_nightly_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
begin
  return jsonb_build_object(
    'pruned_points',    public.prune_walk_points(),
    'abandoned_walks',  public.abandon_stale_walks(),
    'purged_accounts',  public.purge_deleted_accounts(),
    'ran_at',           now()
  );
end;
$fn$;

-- Registers the nightly job. Call once per project, after enabling pg_cron.
create or replace function public.schedule_maintenance()
returns text
language plpgsql
as $fn$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return 'pg_cron is not enabled — enable it in Database → Extensions first.';
  end if;

  perform cron.schedule(
    'terrawars-nightly-maintenance',
    '17 3 * * *',                             -- 03:17 UTC, off the hour on purpose
    $cron$select public.run_nightly_maintenance();$cron$
  );

  return 'Scheduled terrawars-nightly-maintenance at 03:17 UTC daily.';
end;
$fn$;

revoke all on function public.prune_walk_points() from public;
revoke all on function public.abandon_stale_walks() from public;
revoke all on function public.purge_deleted_accounts() from public;
revoke all on function public.run_nightly_maintenance() from public;
revoke all on function public.schedule_maintenance() from public;

comment on function public.prune_walk_points is
  'NFR-09: deletes raw GPS points 30 days after the walk. Load-bearing, not optional.';
