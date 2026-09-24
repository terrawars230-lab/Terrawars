import {AppState, type AppStateStatus} from 'react-native';

import NetInfo from '@react-native-community/netinfo';
import {focusManager, onlineManager, QueryClient} from '@tanstack/react-query';

import {onSignedOut} from '@core/session/session';

import {ApiError} from './ApiError';

/**
 * The app's single React Query client.
 *
 * A module-level singleton rather than one built inside a component, because
 * two things outside the React tree need it: sign-out has to clear it (so the
 * next account on this device never renders the previous one's cached profile
 * through the FR-02 username gate), and the offline claim queue has to
 * invalidate the map once a queued claim lands.
 *
 * The retry policy is the important default: doc 05 §7 says a 422 claim
 * rejection is a normal outcome and only 5xx deserves a retry. Retrying a rule
 * rejection would burn the user's battery re-asking a question with a fixed
 * answer.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (ApiError.isApiError(error)) {
          return error.isRetryable && failureCount < 3;
        }
        return failureCount < 2;
      },
      retryDelay: attempt => Math.min(1000 * 2 ** attempt, 30_000),
      // Location-driven data goes stale fast; everything overrides this.
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      // A walker's phone loses and regains signal constantly. The online
      // manager below pauses queries while offline and this refetches what
      // went stale in the gap exactly once when the connection returns.
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
    },
    mutations: {
      // A mutation retried blindly can double-apply. Every mutating endpoint
      // takes an idempotency key (NFR-06), and the caller decides when to
      // reuse it — never this default.
      retry: false,
    },
  },
});

// Every cached query belongs to the account that fetched it. Without this the
// next player to sign in on the device is shown the previous one's profile —
// and the FR-02 username gate reads `needsUsername` from that stale copy.
onSignedOut(() => {
  queryClient.clear();
});

/**
 * Wires React Query to the React Native app lifecycle.
 *
 * React Query's focus and online detection are built for browsers. Without
 * this, React Native reports "focused and online" forever, so every
 * `refetchInterval` keeps polling while the app sits in a pocket during a walk
 * with the screen off — a direct hit on the NFR-01 battery budget — and
 * requests fire into a dead connection instead of waiting for it to return.
 *
 * Returns a teardown function; call it from the app root's cleanup.
 */
export function bindQueryClientToAppLifecycle(): () => void {
  const handleAppState = (status: AppStateStatus) => {
    focusManager.setFocused(status === 'active');
  };
  const appStateSubscription = AppState.addEventListener('change', handleAppState);

  // `isInternetReachable` is null while unknown; only an explicit `false`
  // counts as offline, or every cold start would begin paused.
  const unsubscribeNetInfo = NetInfo.addEventListener(state => {
    onlineManager.setOnline(Boolean(state.isConnected) && state.isInternetReachable !== false);
  });

  return () => {
    appStateSubscription.remove();
    unsubscribeNetInfo();
  };
}
