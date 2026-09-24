import type {Session} from '@supabase/supabase-js';
import {create} from 'zustand';

import {supabase} from '@core/api/supabase/client';
import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';

import * as authApi from '../api/authApi';

/**
 * Session state.
 *
 * Zustand for client state, React Query for server state. The split is
 * deliberate: the session is the one thing that decides which navigator
 * renders, so it must be synchronously readable outside React (the API layer
 * and the walk recorder both need it) — which a query cache is not designed to
 * be.
 *
 * The store never holds the profile. That is server state, it changes from
 * other devices, and it belongs in React Query under `queryKeys.profile.me()`.
 */

const logger = createLogger('auth-store');

export type AuthStatus = 'initialising' | 'signedOut' | 'signedIn';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  userId: string | null;
  /**
   * True from "send me a code" until the new password is saved.
   *
   * Verifying the code signs the user in, so without this RootNavigator would
   * swap straight to the map and the new-password screen would never render.
   */
  isRecoveringPassword: boolean;

  /** Subscribes to Supabase auth changes. Returns an unsubscribe function. */
  initialise: () => () => void;
  signIn: (credentials: authApi.Credentials) => Promise<void>;
  /** Resolves with `needsEmailConfirmation` so the screen can say what happens next. */
  signUp: (credentials: authApi.Credentials) => Promise<authApi.SignUpResult>;
  signOut: () => Promise<void>;
  setRecoveringPassword: (value: boolean) => void;
}

export const useAuthStore = create<AuthState>(set => ({
  status: 'initialising',
  session: null,
  userId: null,
  isRecoveringPassword: false,

  initialise: () => {
    // onAuthStateChange fires INITIAL_SESSION on subscribe, so the restored
    // session arrives through the same path as a fresh sign-in. Reading
    // getSession() separately would race it and could flash the sign-in screen
    // at a user who is already signed in (FR-07).
    const {data} = supabase.auth.onAuthStateChange((event, session) => {
      logger.debug('Auth state changed', {event, hasSession: Boolean(session)});

      set({
        session,
        userId: session?.user.id ?? null,
        status: session ? 'signedIn' : 'signedOut',
      });

      if (event === 'SIGNED_OUT') {
        set({isRecoveringPassword: false});
        // Wipe cached game state so the next user on this device never sees the
        // previous one's walk. The Supabase session lives in AsyncStorage and
        // is cleared by signOut() itself, so this cannot log anyone out.
        storage.clearAll();
      }
    });

    return () => data.subscription.unsubscribe();
  },

  signIn: async credentials => {
    const session = await authApi.signInWithEmail(credentials);
    set({session, userId: session.user.id, status: 'signedIn'});
  },

  signUp: async credentials => {
    const result = await authApi.signUpWithEmail(credentials);
    if (result.session) {
      set({
        session: result.session,
        userId: result.session.user.id,
        status: 'signedIn',
      });
    }
    // No session means email confirmation is required. The result carries that
    // back so the screen can say so; the listener picks the session up on its
    // own once the user follows the link.
    return result;
  },

  signOut: async () => {
    await authApi.signOut();
    set({session: null, userId: null, status: 'signedOut', isRecoveringPassword: false});
  },

  setRecoveringPassword: value => set({isRecoveringPassword: value}),
}));

/**
 * Reads the current user id outside React.
 *
 * Needed by the walk recorder, which runs on a native event stream rather than
 * in a component tree. Returns `null` when signed out; callers must handle it
 * rather than assuming a session.
 */
export function currentUserId(): string | null {
  return useAuthStore.getState().userId;
}
