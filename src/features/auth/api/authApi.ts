import type {Session} from '@supabase/supabase-js';

import {toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';
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

export async function signUpWithEmail({email, password}: Credentials): Promise<Session | null> {
  const {data, error} = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
  });

  if (error) {
    throw toApiError(error, 'Could not create your account');
  }

  // The profiles and user_stats rows are created by the on_auth_user_created
  // trigger, so there is nothing to insert here. A client-side profile insert
  // would race the trigger and hit the unique username constraint.
  logger.info('Signed up', {hasSession: Boolean(data.session)});
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

export async function setUsername(username: string): Promise<void> {
  const {error} = await supabase
    .from('profiles')
    .update({username: username.trim().toLowerCase()})
    .eq('id', (await supabase.auth.getUser()).data.user?.id ?? '');

  if (error) {
    throw toApiError(error, 'Could not save that name');
  }
}

/**
 * FR-06 / doc 06 §5: in-app account deletion.
 *
 * Soft-deletes and wipes raw location immediately; the hard delete runs after a
 * 7-day grace period. Parcels are reassigned rather than deleted so the world
 * map does not develop holes.
 */
export async function requestAccountDeletion(): Promise<void> {
  const {error} = await supabase.rpc('request_account_deletion');
  if (error) {
    throw toApiError(error, 'Could not delete your account');
  }
  await signOut();
}
