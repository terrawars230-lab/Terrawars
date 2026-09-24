-- ═══════════════════════════════════════════════════════════════════════════
-- 20260904120000 · set_username, and closing the direct-write path to profiles
--
-- Completes the FR-02 signup step. Two things were wrong with the client
-- writing `profiles.username` itself:
--
--  1. FR-02 makes the username permanent — the onboarding copy says so in as
--     many words — but nothing enforced it. `profiles_update_own` allows an
--     UPDATE on the row, so any client could rename itself at will, and a
--     rename breaks every leaderboard screenshot and raid notification that
--     already went out under the old name.
--
--  2. That same policy is per-ROW, not per-COLUMN, so it also allowed a client
--     to write `is_shadow_suspended`, `is_under_review` and `deleted_at`. A
--     shadow-suspended cheater could clear their own flag with one PATCH,
--     which defeats doc 06 §3 entirely, and `color_changed_at` could be
--     rewritten to sidestep the FR-03 30-day cooldown.
--
-- The fix for (1) is this function; the fix for (2) is column-level grants at
-- the bottom of the file. RLS still decides which ROW you may touch; the grant
-- decides which COLUMNS.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── FR-02: claim a username, exactly once ─────────────────────────────────
--
-- SECURITY DEFINER for the same reason as `is_username_available`: the caller
-- must be able to write one column of their own row without holding a general
-- UPDATE grant on it. Every branch scopes to auth.uid(), so the elevated
-- privilege never widens what a caller can reach.
--
-- Returns a doc 05 §7 envelope rather than raising, so the ordinary rejections
-- (taken, malformed, already chosen) arrive as data the client can map to copy
-- instead of as a Postgres error the client has to sniff.
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_uid      uuid := auth.uid();
  v_username text := lower(trim(coalesce(p_username, '')));
  v_current  text;
  v_deleted  timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Sign in required')
    );
  end if;

  -- Same pattern as the CHECK constraint and the client-side regex. Checked
  -- here too because the constraint would surface as an opaque 23514.
  if v_username !~ '^[a-z0-9_]{3,20}$' then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'ERR_VALIDATION', 'message', 'Invalid username')
    );
  end if;

  select username, deleted_at into v_current, v_deleted
    from public.profiles
   where id = v_uid;

  if v_current is null then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'NOT_FOUND', 'message', 'No profile for this account')
    );
  end if;

  if v_deleted is not null then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'ACCOUNT_SUSPENDED', 'message', 'Account is being deleted')
    );
  end if;

  -- CLAUDE.md rule 10: re-submitting the name you already hold succeeds. A
  -- retried request after a dropped response must not read as a failure.
  if v_current = v_username then
    return jsonb_build_object('username', v_current);
  end if;

  -- The provisional `user_xxxx` name from tg_handle_new_user is the only state
  -- from which a name may be set. Anything else means it was already chosen.
  if v_current not like 'user\_%' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'USERNAME_ALREADY_SET',
        'message', 'Your username has already been chosen',
        'details', jsonb_build_object('username', v_current)
      )
    );
  end if;

  if exists (select 1 from public.profiles where username = v_username) then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'USERNAME_TAKEN', 'message', 'That name is taken')
    );
  end if;

  update public.profiles set username = v_username where id = v_uid;

  return jsonb_build_object('username', v_username);
exception
  -- The EXISTS above is a courtesy, not the guard: two devices claiming the
  -- same name in the same instant both pass it and one loses at the unique
  -- index. The loser gets the same answer either way.
  when unique_violation then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'USERNAME_TAKEN', 'message', 'That name is taken')
    );
end;
$fn$;

comment on function public.set_username is
  'FR-02: claims the permanent username. The only write path to profiles.username.';

revoke all on function public.set_username(text) from public;
grant execute on function public.set_username(text) to authenticated;

-- ── update_my_color must stop relying on a table-wide UPDATE grant ─────────
--
-- It was SECURITY INVOKER, so it wrote `color_hex` under the caller's own
-- privileges. Once those privileges no longer include that column it would
-- fail, and the FR-03 cooldown it enforces would go with it. The body already
-- scopes every statement to auth.uid(), so DEFINER changes nothing about what
-- a caller can reach.
create or replace function public.update_my_color(p_color_hex text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_changed_at timestamptz;
begin
  if p_color_hex !~ '^#[0-9A-Fa-f]{6}$' then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'ERR_VALIDATION', 'message', 'Invalid colour')
    );
  end if;

  if auth.uid() is null then
    return jsonb_build_object(
      'error', jsonb_build_object('code', 'UNAUTHENTICATED', 'message', 'Sign in required')
    );
  end if;

  select color_changed_at into v_changed_at
    from public.profiles where id = auth.uid();

  if v_changed_at is not null and v_changed_at > now() - interval '30 days' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'code', 'COLOR_CHANGE_COOLDOWN',
        'message', 'You can change your colour once every 30 days',
        'details', jsonb_build_object('available_at', v_changed_at + interval '30 days')
      )
    );
  end if;

  update public.profiles
     set color_hex = p_color_hex, color_changed_at = now()
   where id = auth.uid();

  return jsonb_build_object('color_hex', p_color_hex);
end;
$fn$;

-- ── Column-level UPDATE grants on profiles ────────────────────────────────
--
-- `profiles_update_own` stays exactly as it was: it decides which ROW you may
-- write. These grants decide which COLUMNS, which RLS has no way to express —
-- a WITH CHECK clause cannot see the old row, so it cannot say "this column
-- did not change".
--
-- Everything left out is deliberate:
--   username                          → set_username (FR-02, once only)
--   color_hex, color_changed_at       → update_my_color (FR-03 cooldown)
--   deleted_at                        → request_account_deletion (FR-06)
--   is_under_review, is_shadow_suspended → doc 06 §3; never client-writable
--   id, created_at, updated_at        → identity and the updated_at trigger
revoke update on public.profiles from authenticated, anon;

grant update (display_name, avatar_url, home_city, home_region)
  on public.profiles to authenticated;
