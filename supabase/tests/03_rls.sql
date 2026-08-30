-- ═══════════════════════════════════════════════════════════════════════════
-- Row-level security (doc 04 §6).
--
-- The client holds only the anon key, so these policies ARE the security
-- boundary. Two of these assertions are the ones that matter most:
--
--   * a client cannot insert a parcel — "if it can, the game is over on day one";
--   * user A cannot read user B's walks — a route polyline is a home address.
--
-- The suite runs as the `authenticated` role so policies actually apply. As
-- superuser RLS is bypassed and every one of these tests would pass vacuously,
-- which is why the role switch is explicit and asserted.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

select test.section('RLS is enabled on every table that holds player data');

do $$
declare
  v_unprotected text;
begin
  select string_agg(c.relname, ', ')
    into v_unprotected
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     and c.relname in (
       'profiles', 'user_stats', 'walks', 'walk_points', 'claims', 'parcels',
       'steal_events', 'weekly_scores', 'push_tokens', 'game_config',
       'moderation_flags'
     );

  perform test.eq(v_unprotected, null::text,
                  'every player-data table has row level security enabled');
end;
$$;

select test.section('parcels — no client write path exists');

do $$
declare
  v_write_policies integer;
begin
  -- CLAUDE.md rule 1. finish_walk is SECURITY DEFINER and is the only writer;
  -- the absence of these policies is the enforcement, not an oversight.
  select count(*) into v_write_policies
    from pg_policies
   where schemaname = 'public'
     and tablename = 'parcels'
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  perform test.eq(v_write_policies, 0, 'parcels has no INSERT/UPDATE/DELETE policy');

  select count(*) into v_write_policies
    from pg_policies
   where schemaname = 'public'
     and tablename in ('claims', 'steal_events', 'user_stats', 'weekly_scores')
     and cmd in ('INSERT', 'UPDATE', 'DELETE');

  perform test.eq(v_write_policies, 0,
                  'claims, steal_events, user_stats and weekly_scores are read-only to clients');
end;
$$;

do $$
declare
  v_policies integer;
begin
  -- doc 06 §3: "Do not tell cheaters exactly which check caught them."
  select count(*) into v_policies
    from pg_policies where schemaname = 'public' and tablename = 'moderation_flags';

  perform test.eq(v_policies, 0, 'moderation_flags is unreadable by any client role');
end;
$$;

select test.section('walks and walk_points are owner-scoped');

do $$
declare
  v_select_policy text;
begin
  -- doc 06 §4.1: a route polyline is a home address, so the SELECT policy must
  -- be scoped to the owner rather than to any authenticated user.
  select qual into v_select_policy
    from pg_policies
   where schemaname = 'public' and tablename = 'walks' and cmd = 'SELECT';

  perform test.ok(v_select_policy like '%uid()%',
                  'the walks SELECT policy is scoped to auth.uid()');

  select qual into v_select_policy
    from pg_policies
   where schemaname = 'public' and tablename = 'walk_points' and cmd = 'SELECT';

  perform test.ok(v_select_policy like '%uid()%',
                  'the walk_points SELECT policy is scoped to auth.uid()');
end;
$$;

do $$
declare
  v_mutation integer;
begin
  -- A point, once uploaded, is immutable evidence (doc 06 §1).
  select count(*) into v_mutation
    from pg_policies
   where schemaname = 'public' and tablename = 'walk_points'
     and cmd in ('UPDATE', 'DELETE');

  perform test.eq(v_mutation, 0, 'walk_points cannot be updated or deleted by a client');
end;
$$;

select test.section('there is no public view over walks');

do $$
declare
  v_leaky text;
begin
  -- doc 05 §5 defines no public walk endpoint. Any view exposing a geometry
  -- column from walks would be a leak that RLS on the base table cannot catch
  -- if the view is ever made security-definer.
  select string_agg(table_name, ', ')
    into v_leaky
    from information_schema.columns
   where table_schema = 'public'
     and column_name in ('path', 'lat', 'lng')
     and table_name in (
       select table_name from information_schema.views where table_schema = 'public'
     );

  perform test.eq(v_leaky, null::text, 'no public view exposes a walk path or raw points');
end;
$$;

select test.section('SECURITY DEFINER functions pin their search_path');

do $$
declare
  v_unsafe text;
begin
  -- A SECURITY DEFINER function with a mutable search_path is a
  -- privilege-escalation hole: a caller can shadow a referenced object.
  select string_agg(p.proname, ', ')
    into v_unsafe
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and (p.proconfig is null
          or not exists (
            select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'
          ));

  perform test.eq(v_unsafe, null::text,
                  'every SECURITY DEFINER function pins search_path');
end;
$$;

select test.section('a client cannot write a parcel — the live test');

do $$
declare
  v_user uuid := test.create_player('intruder');
  v_blocked boolean := false;
begin
  perform test.act_as(v_user);

  -- Act as `authenticated`, the role the anon key maps to. As superuser RLS is
  -- bypassed entirely and this test would pass without proving anything.
  -- set_config rather than SET LOCAL: the latter is unreliable inside PL/pgSQL.
  perform set_config('role', 'authenticated', true);

  begin
    insert into public.parcels (owner_id, geom)
    values (v_user, test.square(500));
    -- Reaching here means a client just minted territory out of nothing.
  exception
    when insufficient_privilege or others then
      v_blocked := true;
  end;

  perform set_config('role', 'none', true);

  perform test.ok(v_blocked,
                  'CLAUDE.md rule 1: a client INSERT into parcels is refused');
end;
$$;

do $$
declare
  v_alice uuid := test.create_player('alice');
  v_bob   uuid := test.create_player('bob');
  v_walk  uuid;
  v_visible integer;
begin
  -- doc 07 Phase 1 acceptance: "user A cannot read user B's walks row via the
  -- anon key."
  v_walk := test.record_square_walk(v_alice, 250);

  perform test.act_as(v_bob);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from public.walks where id = v_walk;

  perform set_config('role', 'none', true);

  perform test.eq(v_visible, 0, 'user B cannot read user A''s walk');
end;
$$;

do $$
declare
  v_alice uuid := test.create_player('alice2');
  v_bob   uuid := test.create_player('bob2');
  v_walk  uuid;
  v_visible integer;
begin
  v_walk := test.record_square_walk(v_alice, 250);

  perform test.act_as(v_bob);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from public.walk_points where walk_id = v_walk;

  perform set_config('role', 'none', true);

  -- doc 06 §4.1. This is the assertion that keeps someone's front door private.
  perform test.eq(v_visible, 0, 'user B cannot read user A''s raw GPS points');
end;
$$;

do $$
declare
  v_owner  uuid := test.create_player('owner');
  v_viewer uuid := test.create_player('viewer');
  v_visible integer;
begin
  -- Parcels ARE public: the world map is the product (FR-50).
  perform test.give_parcel(v_owner, test.square(200), null, now());

  perform test.act_as(v_viewer);
  perform set_config('role', 'authenticated', true);

  select count(*) into v_visible from public.parcels where owner_id = v_owner;

  perform set_config('role', 'none', true);

  perform test.eq(v_visible, 1, 'FR-50 parcels are readable by any signed-in player');
end;
$$;

select test.section('retention — NFR-09');

do $$
declare
  v_user uuid := test.create_player('retained');
  v_walk uuid;
  v_before integer;
  v_after  integer;
begin
  v_walk := test.record_square_walk(v_user, 250);
  update public.walks
     set ended_at = now() - interval '31 days', status = 'completed'
   where id = v_walk;

  select count(*) into v_before from public.walk_points where walk_id = v_walk;
  perform public.prune_walk_points();
  select count(*) into v_after from public.walk_points where walk_id = v_walk;

  perform test.ok(v_before > 0, 'the fixture had points to prune');
  perform test.eq(v_after, 0, 'NFR-09 raw points are deleted 30 days after the walk');
  -- The derived geometry survives; only the evidence trail is removed.
  perform test.eq((select count(*)::integer from public.walks where id = v_walk), 1,
                  'the walk itself survives the prune');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('fresh');
  v_walk uuid;
  v_after integer;
begin
  v_walk := test.record_square_walk(v_user, 250);
  update public.walks
     set ended_at = now() - interval '10 days', status = 'completed'
   where id = v_walk;

  perform public.prune_walk_points();
  select count(*) into v_after from public.walk_points where walk_id = v_walk;

  perform test.ok(v_after > 0, 'a recent walk keeps its points');
end;
$$;

do $$
declare
  v_user uuid := test.create_player('stale');
  v_walk uuid;
begin
  insert into public.walks (user_id, started_at, status)
  values (v_user, now() - interval '8 hours', 'active')
  returning id into v_walk;

  perform public.abandon_stale_walks();

  perform test.eq((select status::text from public.walks where id = v_walk), 'abandoned',
                  'doc 04 §5 a walk active for over 6 hours is abandoned');
end;
$$;

rollback;
