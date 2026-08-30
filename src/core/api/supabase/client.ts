import 'react-native-url-polyfill/auto';

import {AppState} from 'react-native';

import {createClient, type SupabaseClient} from '@supabase/supabase-js';

import {env} from '@core/config/env';
import {createLogger} from '@core/logger/logger';

import type {Database} from './database.types';
import {supabaseAuthStorage} from './supabaseAuthStorage';

/**
 * The single Supabase client for the app.
 *
 * The anon key ships inside the APK — that is by design. RLS (doc 04 §6) is the
 * real security boundary, and `finish_walk` is `SECURITY DEFINER` so the client
 * can never write a parcel (CLAUDE.md rule 1). The service-role key must never
 * appear anywhere in this repo.
 *
 * `react-native-url-polyfill/auto` is imported first because supabase-js builds
 * request URLs with `URL`/`URLSearchParams`, which Hermes does not implement.
 */

const logger = createLogger('supabase');

export const supabase: SupabaseClient<Database> = createClient<Database>(
  env.supabase.url,
  env.supabase.anonKey,
  {
    auth: {
      storage: supabaseAuthStorage,
      // FR-07: the session persists across restarts and refreshes silently.
      persistSession: true,
      autoRefreshToken: true,
      // React Native has no URL bar to parse a magic link out of; OAuth
      // redirects come back through deep links instead (see navigation/linking).
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      headers: {'x-client-info': `terrawars-rn/${env.appEnvironment}`},
    },
    realtime: {
      // doc 05 §6 caps the client at 9 concurrent geohash cells. Ten events a
      // second is ample for parcel churn in one viewport and keeps the socket
      // from waking the CPU more than it must.
      params: {eventsPerSecond: 10},
    },
  },
);

/**
 * Ties Supabase's token-refresh timer to app foreground state.
 *
 * Without this the refresh timer keeps firing while the app is backgrounded,
 * which wakes the radio on a schedule the user gets no benefit from — a direct
 * hit on the NFR-01 battery budget. Supabase documents this as the required
 * React Native setup.
 *
 * Returns an unsubscribe function; call it from the app root's cleanup.
 */
export function startAuthAutoRefresh(): () => void {
  // Widened deliberately: RN types `AppState.currentState` as
  // `string | null | undefined` because it can be unset before the first
  // transition on Android. Only the 'active' comparison matters.
  const handleChange = (state: string | null | undefined) => {
    if (state === 'active') {
      void supabase.auth.startAutoRefresh();
    } else {
      void supabase.auth.stopAutoRefresh();
    }
  };

  handleChange(AppState.currentState);
  const subscription = AppState.addEventListener('change', handleChange);

  logger.debug('Auth auto-refresh bound to app state');

  return () => {
    subscription.remove();
    void supabase.auth.stopAutoRefresh();
  };
}
