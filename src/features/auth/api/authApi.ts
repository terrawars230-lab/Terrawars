import type {Session} from '@supabase/supabase-js';

import {parseErrorEnvelope, toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';
import {env} from '@core/config/env';
import {createLogger} from '@core/logger/logger';

/**
 * Auth repository (doc 05 §1).
 *
 * Every screen goes through these functions rather than touching
 * `supabase.auth` directly. That indirection is what keeps ADR D-02 — swapping
 * Supabase for something else — a change to this file rather than to every
 * screen, and it is where Supabase's several error shapes become one
 * `ApiError`.
 */

const logger = createLogger('auth');

export interface Credentials {
  email: string;
  password: string;
}

export interface SignUpResult {
  session: Session | null;
  /**
   * True when the project requires email confirmation, so no session exists
   * yet. The caller MUST branch on this: without it, sign-up on a
   * confirmation-enabled project ends with the spinner stopping and nothing
   * else happening, which reads as a broken button.
   */
  needsEmailConfirmation: boolean;
}

export async function signUpWithEmail({email, password}: Credentials): Promise<SignUpResult> {
  const {data, error} = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    // Where the confirmation LINK lands once it has verified the address. The
    // app itself confirms with the emailed code (verifySignUpOtp), so this only
    // decides what a user who taps the link instead sees: a page telling them
    // to return to the app, rather than the project's default Site URL.
    options: env.authEmailRedirectUrl ? {emailRedirectTo: env.authEmailRedirectUrl} : undefined,
  });

  if (error) {
    throw toApiError(error, 'Could not create your account');
  }

  // The profiles and user_stats rows are created by the on_auth_user_created
  // trigger, so there is nothing to insert here. A client-side profile insert
  // would race the trigger and hit the unique username constraint.
  logger.info('Signed up', {hasSession: Boolean(data.session)});

  return {session: data.session, needsEmailConfirmation: data.session === null};
}

/**
 * Re-sends the sign-up confirmation email.
 *
 * Without this a user who never received the first one is stuck for good:
 * signing up again with the same address returns `user_already_exists`, and
 * signing in returns `email_not_confirmed`. Neither has a way out.
 */
export async function resendConfirmationEmail(email: string): Promise<void> {
  const {error} = await supabase.auth.resend({
    type: 'signup',
    email: email.trim().toLowerCase(),
    options: env.authEmailRedirectUrl ? {emailRedirectTo: env.authEmailRedirectUrl} : undefined,
  });

  if (error) {
    throw toApiError(error, 'Could not send that email again');
  }
}

/**
 * FR-01: confirms a new account with the 6-digit code from the sign-up email.
 *
 * A code rather than the link, for the same reason as password recovery: the
 * link opens a browser, verifies the address there and leaves the app still
 * signed out, with nothing to tell the user what to do next. A code typed into
 * the app confirms the address AND signs the user in, on this device, with no
 * deep link to get wrong.
 *
 * `type: 'email'` covers sign-up confirmation for an unconfirmed address.
 * Requires `{{ .Token }}` in the Supabase "Confirm signup" email template.
 */
export async function verifySignUpOtp(email: string, token: string): Promise<Session> {
  const {data, error} = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'email',
  });

  if (error || !data.session) {
    throw toApiError(error, 'That code did not work');
  }
  return data.session;
}

export async function signInWithEmail({email, password}: Credentials): Promise<Session> {
  const {data, error} = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    throw toApiError(error, 'Could not sign you in');
  }
  return data.session;
}

/**
 * Starts the Google OAuth flow (FR-01).
 *
 * Returns the URL the caller opens in a browser. The redirect comes back to
 * `terrawars://auth/callback` and is exchanged for a session by
 * `completeOAuthSignIn` — see `navigation/linking.ts` for why the client does
 * not parse the session out of a URL itself.
 */
export async function startGoogleSignIn(): Promise<string> {
  const {data, error} = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: 'terrawars://auth/callback',
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    throw toApiError(error, 'Could not start Google sign-in');
  }
  return data.url;
}

/** Exchanges the PKCE code from the deep-link callback for a session. */
export async function completeOAuthSignIn(callbackUrl: string): Promise<Session> {
  const code = new URL(callbackUrl).searchParams.get('code');
  if (!code) {
    throw toApiError(new Error('Missing authorisation code'), 'Sign-in was cancelled');
  }

  const {data, error} = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    throw toApiError(error, 'Could not complete sign-in');
  }
  return data.session;
}

export async function sendPasswordReset(email: string): Promise<void> {
  const {error} = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: 'terrawars://auth/reset',
  });
  if (error) {
    throw toApiError(error, 'Could not send the reset email');
  }
}

/**
 * FR-01: exchanges the emailed recovery code for a session.
 *
 * OTP rather than the magic link in the same email: a link has to survive a
 * deep link back into the app, and `terrawars://auth/reset` has no route. A
 * code the user types works with no linking at all.
 *
 * Requires `{{ .Token }}` in the Supabase "Reset Password" email template —
 * the default template only carries the link.
 */
export async function verifyPasswordResetOtp(email: string, token: string): Promise<Session> {
  const {data, error} = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: 'recovery',
  });

  if (error || !data.session) {
    throw toApiError(error, 'That code did not work');
  }
  return data.session;
}

/** Sets a new password for the session `verifyPasswordResetOtp` produced. */
export async function updatePassword(password: string): Promise<void> {
  const {error} = await supabase.auth.updateUser({password});
  if (error) {
    throw toApiError(error, 'Could not change your password');
  }
}

export async function signOut(): Promise<void> {
  const {error} = await supabase.auth.signOut();
  if (error) {
    // A failed sign-out still has to clear local state, or the user is stuck
    // in a session they have explicitly asked to leave.
    logger.warn('Sign-out reported an error; clearing local session anyway');
  }
}

export async function getSession(): Promise<Session | null> {
  const {data, error} = await supabase.auth.getSession();
  if (error) {
    throw toApiError(error, 'Could not read your session');
  }
  return data.session;
}

/** FR-02: live username availability check. */
export async function isUsernameAvailable(username: string): Promise<boolean> {
  const {data, error} = await supabase.rpc('is_username_available', {
    p_username: username.trim().toLowerCase(),
  });

  if (error) {
    throw toApiError(error, 'Could not check that name');
  }
  return Boolean(data);
}

/**
 * FR-02: claims the permanent username.
 *
 * Goes through the `set_username` RPC rather than an UPDATE on `profiles`.
 * The table write could not enforce "once only" — FR-02 and the onboarding
 * copy both promise the name is permanent — and it needed a table-wide UPDATE
 * grant, which also let a client write `is_shadow_suspended` (doc 06 §3). The
 * function owns both rules; the client no longer holds the grant.
 *
 * Returns the stored name, which may differ from what was typed only by the
 * trimming and lower-casing both sides apply.
 */
export async function setUsername(username: string): Promise<string> {
  const {data, error} = await supabase.rpc('set_username', {
    p_username: username.trim().toLowerCase(),
  });

  if (error) {
    throw toApiError(error, 'Could not save that name');
  }

  // doc 05 §7: the expected rejections (taken, malformed, already chosen) come
  // back as a 200 carrying an error envelope, not as a thrown error.
  const rejection = parseErrorEnvelope(data);
  if (rejection) {
    throw rejection;
  }

  return String((data as {username?: unknown} | null)?.username ?? username);
}

/**
 * FR-06 / doc 06 §5: in-app account deletion.
 *
 * Soft-deletes and wipes raw location immediately; the hard delete runs after a
 * 7-day grace period. Parcels are reassigned rather than deleted so the world
 * map does not develop holes.
 */
export async function requestAccountDeletion(): Promise<void> {
  const {data, error} = await supabase.rpc('request_account_deletion');
  if (error) {
    throw toApiError(error, 'Could not delete your account');
  }

  // The function reports "not signed in" as an envelope on a 200, not as an
  // error. Treating that as success would sign the user out believing their
  // data was queued for deletion when nothing happened.
  const rejection = parseErrorEnvelope(data);
  if (rejection) {
    throw rejection;
  }

  logger.info('Account deletion requested');
  await signOut();
}
