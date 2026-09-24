-- ═══════════════════════════════════════════════════════════════════════════
-- Signup and username (FR-01, FR-02, FR-03, doc 06 §3).
--
-- The signup path is the one every player walks exactly once, and its failures
-- are silent: a profile row that never appeared, a username claimed twice, or
-- a column a client should never have been able to write. None of those show
-- up as an error at signup time — they show up weeks later as a duplicate
-- leaderboard entry or an unenforceable suspension.
--
-- Runs as the `authenticated` role wherever a privilege is under test. As
-- superuser both RLS and column grants are bypassed and every assertion would
-- pass without proving anything.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

begin;

-- ── The signup trigger ────────────────────────────────────────────────────

select test.section('on_auth_user_created creates a usable profile');

do $$
declare
  v_id       uuid := extensions.gen_random_uuid();
  v_username text;
  v_color    text;
  v_stats    integer;
begin
  -- No raw_user_meta_data, i.e. a plain email/password signup. Google sign-in
  -- supplies a username hint; email signup supplies nothing at all, and that
  -- is the case that must still produce a valid row.
  insert into auth.users (id, email) values (v_id, 'provisional@example.test');

  select username, color_hex into v_username, v_color
    from public.profiles where id = v_id;

  select count(*) into v_stats from public.user_stats where user_id = v_id;

  perform test.ok(v_username is not null,
                  'a profile row exists the moment auth.users gains one');
  perform test.ok(v_username like 'user\_%',
                  'FR-02: the placeholder username marks the name as not yet chosen');
  perform test.ok(v_username ~ '^[a-z0-9_]{3,20}$',
                  'the placeholder already satisfies the FR-02 username constraint');
  perform test.eq(v_stats, 1, 'user_stats is created alongside the profile');
  perform test.ok(v_color ~ '^#[0-9A-Fa-f]{6}$',
                  'FR-03: a territory colour is assigned at signup');
  perform test.eq(v_color, public.assign_signup_color(v_id),
                  'FR-03: the signup colour is deterministic from the user id');
end;
$$;

select test.section('get_me reports the username gate');

do $$
declare
  v_id uuid := extensions.gen_random_uuid();
  v_me jsonb;
begin
  insert into auth.users (id, email) values (v_id, 'gate@example.test');
  perform test.act_as(v_id);

  v_me := public.get_me();
  perform test.eq((v_me ->> 'needs_username')::boolean, true,
                  'FR-02: a fresh account is sent to the username gate');

  perform public.set_username('pathfinder');

  v_me := public.get_me();
  perform test.eq((v_me ->> 'needs_username')::boolean, false,
                  'FR-02: the gate closes once a name is chosen');
  perform test.eq(v_me ->> 'username', 'pathfinder',
                  'get_me returns the chosen name');

  perform test.act_as(null);
end;
$$;

-- ── set_username ──────────────────────────────────────────────────────────

select test.section('set_username enforces the FR-02 rules');

do $$
declare
  v_id     uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  insert into auth.users (id, email) values (v_id, 'namer@example.test');
  perform test.act_as(v_id);

  v_result := public.set_username('No Spaces Allowed');
  perform test.eq(v_result #>> '{error,code}', 'ERR_VALIDATION',
                  'FR-02: a malformed username is refused');

  v_result := public.set_username('ab');
  perform test.eq(v_result #>> '{error,code}', 'ERR_VALIDATION',
                  'FR-02: fewer than 3 characters is refused');

  v_result := public.set_username(repeat('a', 21));
  perform test.eq(v_result #>> '{error,code}', 'ERR_VALIDATION',
                  'FR-02: more than 20 characters is refused');

  v_result := public.set_username('  TrailBlazer  ');
  perform test.eq(v_result ->> 'username', 'trailblazer',
                  'FR-02: the name is trimmed and lower-cased before it is stored');

  -- CLAUDE.md rule 10. A retry after a dropped response must not read as a
  -- failure, or the user is told their own name is taken.
  v_result := public.set_username('trailblazer');
  perform test.eq(v_result ->> 'username', 'trailblazer',
                  'idempotent: re-claiming the name you already hold succeeds');

  v_result := public.set_username('somethingelse');
  perform test.eq(v_result #>> '{error,code}', 'USERNAME_ALREADY_SET',
                  'FR-02: the username is permanent — a second, different name is refused');

  perform test.eq((select username from public.profiles where id = v_id), 'trailblazer',
                  'the refused rename left the stored name untouched');

  perform test.act_as(null);
end;
$$;

do $$
declare
  v_taken uuid := test.create_player('cartographer');
  v_id    uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  insert into auth.users (id, email) values (v_id, 'latecomer@example.test');
  perform test.act_as(v_id);

  v_result := public.set_username('cartographer');
  perform test.eq(v_result #>> '{error,code}', 'USERNAME_TAKEN',
                  'FR-02: a name another player already holds is refused');

  -- Case only: usernames are stored lower-case, so this is the same name.
  v_result := public.set_username('CARTOGRAPHER');
  perform test.eq(v_result #>> '{error,code}', 'USERNAME_TAKEN',
                  'FR-02: uniqueness is case-insensitive because the name is folded first');

  perform test.ok(v_taken is not null, 'fixture player exists');
  perform test.act_as(null);
end;
$$;

do $$
declare
  v_result jsonb;
begin
  perform test.act_as(null);
  v_result := public.set_username('ghost');
  perform test.eq(v_result #>> '{error,code}', 'UNAUTHENTICATED',
                  'set_username refuses a caller with no session');
end;
$$;

-- ── The write path to profiles is columns, not rows ───────────────────────
--
-- `profiles_update_own` is a row policy: it says which row you may write, and
-- has no way to say which columns. Postgres cannot express "this column did
-- not change" in a WITH CHECK clause — the old row is not visible there — so
-- the column list is a GRANT, and this is what asserts it.

select test.section('a client cannot write the privileged profile columns');

do $$
declare
  v_locked text;
begin
  select string_agg(col, ', ')
    into v_locked
    from unnest(array[
           'username', 'color_hex', 'color_changed_at',
           'is_under_review', 'is_shadow_suspended', 'deleted_at'
         ]) as col
   where has_column_privilege('authenticated', 'public.profiles', col, 'UPDATE');

  perform test.eq(v_locked, null::text,
                  'doc 06 §3 / FR-02 / FR-03: no privileged profile column is client-writable');

  perform test.ok(
    has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE'),
    'the genuinely user-owned columns are still writable');
end;
$$;

do $$
declare
  v_id      uuid := test.create_player('suspect');
  v_blocked boolean := false;
begin
  update public.profiles set is_shadow_suspended = true where id = v_id;

  perform test.act_as(v_id);
  perform set_config('role', 'authenticated', true);

  begin
    -- doc 06 §3: the flag is never disclosed to the client and must never be
    -- clearable by it. Reaching the end of this block means a cheater can lift
    -- their own suspension with one PATCH.
    update public.profiles set is_shadow_suspended = false where id = v_id;
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;

  perform set_config('role', 'none', true);

  perform test.ok(v_blocked,
                  'doc 06 §3: a client cannot clear its own shadow suspension');
  perform test.eq((select is_shadow_suspended from public.profiles where id = v_id), true,
                  'the suspension flag survived the attempt');
  perform test.act_as(null);
end;
$$;

do $$
declare
  v_id      uuid := test.create_player('renamer');
  v_blocked boolean := false;
begin
  perform test.act_as(v_id);
  perform set_config('role', 'authenticated', true);

  begin
    update public.profiles set username = 'renamed' where id = v_id;
  exception
    when insufficient_privilege then
      v_blocked := true;
  end;

  perform set_config('role', 'none', true);

  perform test.ok(v_blocked,
                  'FR-02: set_username is the only write path to profiles.username');
  perform test.act_as(null);
end;
$$;

-- ── The RPCs still work without the table grant ───────────────────────────
--
-- Revoking the columns is only safe because every legitimate write moved to a
-- SECURITY DEFINER function. If one were missed it would fail here rather than
-- in a user's hands.

select test.section('get_me reports no deletion for an ordinary account');

do $$
declare
  v_id uuid := test.create_player('ordinary');
begin
  perform test.act_as(v_id);
  perform set_config('role', 'authenticated', true);

  perform test.eq(public.get_me() ->> 'deletion_requested', 'false',
                  'FR-06: an account nobody asked to delete is not flagged');

  perform set_config('role', 'none', true);
  perform test.act_as(null);
end;
$$;

select test.section('the profile RPCs survive the column lockdown');

do $$
declare
  v_id     uuid := test.create_player('painter');
  v_result jsonb;
begin
  perform test.act_as(v_id);
  -- As `authenticated`, so the column grants are actually in force. The point
  -- of the test is that a SECURITY DEFINER function writes a column the caller
  -- itself cannot; as superuser it would pass either way.
  perform set_config('role', 'authenticated', true);

  v_result := public.update_my_color('#10B981');
  perform test.eq(v_result ->> 'color_hex', '#10B981',
                  'FR-03: update_my_color still writes a column the caller cannot');

  v_result := public.update_my_color('#EF4444');
  perform test.eq(v_result #>> '{error,code}', 'COLOR_CHANGE_COOLDOWN',
                  'FR-03: the 30-day cooldown still applies');

  v_result := public.request_account_deletion();
  perform test.eq(v_result ->> 'status', 'deletion_requested',
                  'FR-06: account deletion still writes deleted_at');

  -- FR-06: the app reads this to stop a pending-deletion account from playing.
  perform test.eq(public.get_me() ->> 'deletion_requested', 'true',
                  'FR-06: get_me reports the deletion grace period');

  perform set_config('role', 'none', true);

  perform test.eq((select color_hex from public.profiles where id = v_id), '#10B981',
                  'the colour was actually stored');
  perform test.ok((select deleted_at is not null from public.profiles where id = v_id),
                  'the account is soft-deleted');

  perform test.act_as(null);
end;
$$;

do $$
declare
  v_id     uuid := extensions.gen_random_uuid();
  v_result jsonb;
begin
  insert into auth.users (id, email) values (v_id, 'departing@example.test');
  perform test.act_as(v_id);
  perform set_config('role', 'authenticated', true);

  perform public.request_account_deletion();

  v_result := public.set_username('toolate');
  perform test.eq(v_result #>> '{error,code}', 'ACCOUNT_SUSPENDED',
                  'a soft-deleted account cannot claim a username');

  perform set_config('role', 'none', true);
  perform test.act_as(null);
end;
$$;

rollback;
