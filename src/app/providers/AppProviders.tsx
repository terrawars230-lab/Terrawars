import React, {useEffect, useMemo, type PropsWithChildren} from 'react';

import {StyleSheet} from 'react-native';

import {NavigationContainer} from '@react-navigation/native';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {I18nextProvider} from 'react-i18next';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ErrorBoundary} from '@components/index';
import {ApiError} from '@core/api/ApiError';
import {startAuthAutoRefresh} from '@core/api/supabase/client';
import {i18n, initI18n} from '@core/i18n/index';
import {ThemeProvider} from '@core/theme/ThemeProvider';
import {useAuthStore} from '@features/auth/store/authStore';
import {startQueueAutoFlush} from '@features/walk/services/claimQueue';
import {linking} from '@navigation/linking';

/**
 * Everything the app tree needs, assembled once.
 *
 * Provider order is not arbitrary:
 *  - `GestureHandlerRootView` must be the outermost native view;
 *  - `SafeAreaProvider` before anything that reads insets;
 *  - `ThemeProvider` before the ErrorBoundary, so the fallback can be themed;
 *  - `NavigationContainer` innermost, so a navigation crash is caught.
 */

initI18n();

/**
 * React Query defaults, tuned for a phone on mobile data.
 *
 * The retry policy is the important one: doc 05 §7 says a 422 claim rejection
 * is a normal outcome and only 5xx deserves a retry. Retrying a rule rejection
 * would burn the user's battery re-asking a question with a fixed answer.
 */
function createQueryClient(): QueryClient {
  return new QueryClient({
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
        // A walker's phone loses and regains signal constantly. Refetching on
        // every reconnect would hammer the API for data that has not changed.
        refetchOnReconnect: 'always',
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
}

export function AppProviders({children}: PropsWithChildren): React.JSX.Element {
  const queryClient = useMemo(createQueryClient, []);
  const initialiseAuth = useAuthStore(state => state.initialise);

  useEffect(() => {
    // Order matters: the auth subscription must exist before anything reads a
    // session, and the queue flush needs a session to submit against.
    const unsubscribeAuth = initialiseAuth();
    const stopAutoRefresh = startAuthAutoRefresh();
    const stopQueueFlush = startQueueAutoFlush();

    return () => {
      unsubscribeAuth();
      stopAutoRefresh();
      stopQueueFlush();
    };
  }, [initialiseAuth]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={queryClient}>
              <ErrorBoundary scope="root">
                <NavigationContainer linking={linking}>{children}</NavigationContainer>
              </ErrorBoundary>
            </QueryClientProvider>
          </I18nextProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1},
});
