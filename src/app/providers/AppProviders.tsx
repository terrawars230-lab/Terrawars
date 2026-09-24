import React, {useEffect, type PropsWithChildren} from 'react';

import {StyleSheet} from 'react-native';

import {DarkTheme, NavigationContainer, type Theme as NavigationTheme} from '@react-navigation/native';
import {QueryClientProvider} from '@tanstack/react-query';
import {I18nextProvider} from 'react-i18next';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';

import {ErrorBoundary} from '@components/index';
import {bindQueryClientToAppLifecycle, queryClient} from '@core/api/queryClient';
import {startAuthAutoRefresh} from '@core/api/supabase/client';
import {i18n, initI18n} from '@core/i18n/index';
import {installGlobalErrorHandler} from '@core/logger/globalErrorHandler';
import {ThemeProvider} from '@core/theme/ThemeProvider';
import {nocturneColors} from '@core/theme/tokens';
import {useAuthStore} from '@features/auth/store/authStore';
import {flushQueue, onClaimFlushed, startQueueAutoFlush} from '@features/walk/services/claimQueue';
import {
  invalidateTerritoryQueries,
  startWalkRecorderService,
} from '@features/walk/services/walkRecorder';
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

installGlobalErrorHandler();
initI18n();

/**
 * The navigator's own colours, from Nocturne.
 *
 * Without this, react-navigation paints its default light theme behind every
 * screen transition and header — a white flash between two dark screens.
 */
const navigationTheme: NavigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: nocturneColors.accent,
    background: nocturneColors.background,
    card: nocturneColors.surface,
    text: nocturneColors.textPrimary,
    border: nocturneColors.border,
    notification: nocturneColors.danger,
  },
};

export function AppProviders({children}: PropsWithChildren): React.JSX.Element {
  const initialiseAuth = useAuthStore(state => state.initialise);

  useEffect(() => {
    // Order matters: the auth subscription must exist before anything reads a
    // session, and the recorder must be listening before any walk can start.
    const unsubscribeAuth = initialiseAuth();
    const stopAutoRefresh = startAuthAutoRefresh();
    const unbindQueryClient = bindQueryClientToAppLifecycle();
    const stopRecorder = startWalkRecorderService();
    const stopQueueFlush = startQueueAutoFlush();

    // A claim that lands from the offline queue changes the map and the
    // player's totals exactly like one submitted live (FR-32).
    const unsubscribeFlushed = onClaimFlushed(() => invalidateTerritoryQueries());

    // FR-20: the queue can only submit with a session. Flush the moment one
    // appears, rather than waiting for the next connectivity change.
    const unsubscribeStatus = useAuthStore.subscribe((state, previous) => {
      if (state.status === 'signedIn' && previous.status !== 'signedIn') {
        void flushQueue();
      }
    });

    return () => {
      unsubscribeStatus();
      unsubscribeFlushed();
      stopQueueFlush();
      stopRecorder();
      unbindQueryClient();
      stopAutoRefresh();
      unsubscribeAuth();
    };
  }, [initialiseAuth]);

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <ThemeProvider>
          <I18nextProvider i18n={i18n}>
            <QueryClientProvider client={queryClient}>
              <ErrorBoundary scope="root">
                <NavigationContainer linking={linking} theme={navigationTheme}>
                  {children}
                </NavigationContainer>
              </ErrorBoundary>
            </QueryClientProvider>
          </I18nextProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {flex: 1, backgroundColor: nocturneColors.background},
});
