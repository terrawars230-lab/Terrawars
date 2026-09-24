import {createLogger} from '@core/logger/logger';

/**
 * Who is signed in, readable from anywhere, and what has to happen when they
 * sign out.
 *
 * Lives in `core` rather than in the auth feature so the services that need it
 * — the offline claim queue, the walk recorder — can depend on it without
 * importing the auth store and, through it, the whole Supabase client. That is
 * also what keeps them unit-testable: a test sets the user id and moves on.
 */

const logger = createLogger('session');

let signedInUserId: string | null = null;

/** Called by the auth store on every session change. */
export function setSessionUserId(userId: string | null): void {
  signedInUserId = userId;
}

/** The signed-in user's id, or `null` when signed out. */
export function getSessionUserId(): string | null {
  return signedInUserId;
}

type SignOutCleanup = () => void | Promise<void>;

const signOutCleanups = new Set<SignOutCleanup>();

/**
 * Registers work that must run whenever the session ends — an explicit sign-out,
 * an account deletion, or a refresh token the server no longer accepts.
 *
 * Each feature registers its own cleanup rather than the auth store reaching
 * into every feature, so a new piece of per-user state cannot be forgotten by
 * the one module that happens not to know about it.
 */
export function onSignedOut(cleanup: SignOutCleanup): () => void {
  signOutCleanups.add(cleanup);
  return () => {
    signOutCleanups.delete(cleanup);
  };
}

/**
 * Runs every registered cleanup. One failing cleanup never stops the rest: a
 * half-cleared session is exactly the state this exists to prevent.
 */
export async function runSignedOutCleanups(): Promise<void> {
  for (const cleanup of [...signOutCleanups]) {
    try {
      await cleanup();
    } catch (error) {
      logger.error('A sign-out cleanup failed', error);
    }
  }
}
