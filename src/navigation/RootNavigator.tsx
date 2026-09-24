import React from 'react';

import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {ErrorBoundary, Icon, Loader} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {useTheme} from '@core/theme/ThemeProvider';
import {ChooseUsernameScreen} from '@features/auth/screens/ChooseUsernameScreen';
import {ConfirmEmailScreen} from '@features/auth/screens/ConfirmEmailScreen';
import {DeletionPendingScreen} from '@features/auth/screens/DeletionPendingScreen';
import {ForgotPasswordScreen} from '@features/auth/screens/ForgotPasswordScreen';
import {ResetPasswordScreen} from '@features/auth/screens/ResetPasswordScreen';
import {SignInScreen} from '@features/auth/screens/SignInScreen';
import {SignUpScreen} from '@features/auth/screens/SignUpScreen';
import {VerifyOtpScreen} from '@features/auth/screens/VerifyOtpScreen';
import {useAuthStore} from '@features/auth/store/authStore';
import {LeaderboardScreen} from '@features/leaderboard/screens/LeaderboardScreen';
import {MapScreen} from '@features/map/screens/MapScreen';
import {ParcelDetailScreen} from '@features/map/screens/ParcelDetailScreen';
import {LocationRationaleScreen} from '@features/onboarding/screens/LocationRationaleScreen';
import {OnboardingScreen} from '@features/onboarding/screens/OnboardingScreen';
import {fetchMyProfile} from '@features/profile/api/profileApi';
import {ProfileScreen} from '@features/profile/screens/ProfileScreen';
import {PublicProfileScreen} from '@features/profile/screens/PublicProfileScreen';
import {SettingsScreen} from '@features/settings/screens/SettingsScreen';
import {ActiveWalkScreen} from '@features/walk/screens/ActiveWalkScreen';
import {BatteryGuidanceScreen} from '@features/walk/screens/BatteryGuidanceScreen';
import {ClaimResultScreen} from '@features/walk/screens/ClaimResultScreen';
import {SafetyNoticeScreen} from '@features/walk/screens/SafetyNoticeScreen';

import type {MainTabParamList, RootStackParamList} from './types';

/**
 * Tab icons, hoisted out of `MainTabs`.
 *
 * `tabBarIcon` is a render prop, so an inline arrow makes React see a new
 * component type on every render of the navigator and remount the icon. The
 * navigator passes the tint and size it has already resolved for the
 * active/inactive state, so nothing here restates the theme.
 */
type TabIconProps = {color: string; size: number};

/** Nocturne draws the tab icons at 21, a step down from the 24 grid. */
const TAB_ICON_SIZE = 21;

const MapTabIcon = ({color}: TabIconProps) => <Icon name="map" color={color} size={TAB_ICON_SIZE} />;
const LeaderboardTabIcon = ({color}: TabIconProps) => (
  <Icon name="trophy" color={color} size={TAB_ICON_SIZE} />
);
const ProfileTabIcon = ({color}: TabIconProps) => (
  <Icon name="user" color={color} size={TAB_ICON_SIZE} />
);

/**
 * The walk screen is its own error boundary. A crash in the map renderer during
 * an active walk must not take the recorder down with it — the walk lives in a
 * store and on disk (FR-15), and the recorder runs outside React entirely, so
 * remounting this subtree is recoverable rather than a lost walk.
 *
 * Declared at module scope: an inline render function would be a new
 * component type on every render of the navigator and remount the screen.
 */
function ActiveWalkRoute(): React.JSX.Element {
  return (
    <ErrorBoundary scope="walk">
      <ActiveWalkScreen />
    </ErrorBoundary>
  );
}

/** Its own boundary for the same reason: the map is the most likely renderer to throw. */
function MapRoute(): React.JSX.Element {
  return (
    <ErrorBoundary scope="map">
      <MapScreen />
    </ErrorBoundary>
  );
}

/**
 * The navigation tree.
 *
 * Three states, chosen by data rather than by imperative navigation:
 *
 *  1. signed out → auth stack;
 *  2. signed in but no username yet → the FR-02 gate;
 *  3. signed in and set up → the main tabs.
 *
 * Rendering a different tree instead of calling `navigate()` is what makes
 * sign-out safe: there is no way to end up on the map with no session, because
 * the map screen is not mounted at all in that state.
 */

const RootStack = createNativeStackNavigator<RootStackParamList>();
const Tabs = createBottomTabNavigator<MainTabParamList>();

/**
 * Shared stack options.
 *
 * `slide_from_right` on every stack rather than per-navigator defaults: RN
 * 0.87's native-stack picks a different default per platform, so leaving it
 * unset means the auth flow slides on iOS and fades on Android. Modals opt out
 * individually — a sheet that arrives from the side is not a sheet.
 */
const stackScreenOptions = {headerShown: false, animation: 'slide_from_right'} as const;

export function RootNavigator(): React.JSX.Element {
  const status = useAuthStore(state => state.status);
  const isRecoveringPassword = useAuthStore(state => state.isRecoveringPassword);

  // The auth store restores the session from storage before this resolves, so
  // a returning user goes straight to the map with no sign-in flash (FR-07).
  if (status === 'initialising') {
    return <Loader />;
  }

  if (status === 'signedOut') {
    return <AuthStack />;
  }

  // Checked before the authenticated stack: verifying a recovery code signs
  // the user in, and dropping them on the map with the password they just
  // declared lost is the one outcome this flow must not produce.
  if (isRecoveringPassword) {
    return (
      <RootStack.Navigator screenOptions={stackScreenOptions}>
        <RootStack.Screen name="ResetPassword" component={ResetPasswordScreen} />
      </RootStack.Navigator>
    );
  }

  return <AuthenticatedStack />;
}

function AuthStack(): React.JSX.Element {
  // Onboarding explains the game once. A player who has seen it — who signed
  // out, or whose session expired — goes straight to signing in rather than
  // being walked through three screens they already know.
  const hasSeenOnboarding = storage.getBoolean(StorageKeys.onboardingCompleted);

  return (
    <RootStack.Navigator
      screenOptions={stackScreenOptions}
      initialRouteName={hasSeenOnboarding ? 'SignIn' : 'Onboarding'}>
      <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      <RootStack.Screen name="SignUp" component={SignUpScreen} />
      <RootStack.Screen name="SignIn" component={SignInScreen} />
      <RootStack.Screen name="ConfirmEmail" component={ConfirmEmailScreen} />
      <RootStack.Screen name="ForgotPassword" component={ForgotPasswordScreen} />
      <RootStack.Screen name="VerifyOtp" component={VerifyOtpScreen} />
    </RootStack.Navigator>
  );
}

function AuthenticatedStack(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();

  // FR-02: the username gate. `needs_username` is computed server-side in
  // get_me() rather than inferred from a local flag, so a user who signed up on
  // another device is still prompted exactly once.
  //
  // A failed or offline fetch falls through to the tabs deliberately: NFR-08
  // requires a walk to be recordable with no connection at all, and blocking
  // the whole app on this request would make that impossible.
  const {data: profile, isLoading} = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: fetchMyProfile,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Loader />;
  }

  if (profile?.deletionRequested) {
    return <DeletionPendingScreen />;
  }

  if (profile?.needsUsername) {
    return (
      <RootStack.Navigator screenOptions={stackScreenOptions}>
        <RootStack.Screen name="ChooseUsername" component={ChooseUsernameScreen} />
      </RootStack.Navigator>
    );
  }

  const headerOptions = {
    headerShown: true,
    headerStyle: {backgroundColor: theme.colors.background},
    headerTintColor: theme.colors.textPrimary,
    headerShadowVisible: false,
  } as const;

  return (
    <RootStack.Navigator
      screenOptions={{
        ...stackScreenOptions,
        contentStyle: {backgroundColor: theme.colors.background},
      }}>
      <RootStack.Screen name="MainTabs" component={MainTabs} />
      <RootStack.Screen name="ActiveWalk" component={ActiveWalkRoute} />

      <RootStack.Screen
        name="ClaimResult"
        component={ClaimResultScreen}
        // No swipe back off the result screen: the claim has already resolved
        // and there is nothing to go back to.
        options={{gestureEnabled: false}}
      />

      <RootStack.Screen
        name="LocationRationale"
        component={LocationRationaleScreen}
        options={{presentation: 'modal', animation: 'slide_from_bottom'}}
      />
      <RootStack.Screen
        name="SafetyNotice"
        component={SafetyNoticeScreen}
        options={{presentation: 'modal', animation: 'slide_from_bottom'}}
      />
      <RootStack.Screen
        name="BatteryGuidance"
        component={BatteryGuidanceScreen}
        options={{...headerOptions, title: ''}}
      />
      <RootStack.Screen
        name="ParcelDetail"
        component={ParcelDetailScreen}
        options={{
          ...headerOptions,
          presentation: 'modal',
          animation: 'slide_from_bottom',
          title: t('parcel.area'),
        }}
      />
      <RootStack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
        options={{...headerOptions, title: ''}}
      />
      <RootStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{...headerOptions, title: t('settings.title')}}
      />
    </RootStack.Navigator>
  );
}

function MainTabs(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();

  return (
    <Tabs.Navigator
      screenOptions={{
        headerShown: false,
        // Tabs slide sideways in the direction of travel; a push animation
        // between siblings would imply a hierarchy the tabs do not have.
        animation: 'shift',
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.tabInactive,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
          borderTopWidth: 1,
        },
        // NFR-10: tab labels must scale with the system font size, so this sets
        // the size and lets it grow rather than pinning a height on the bar.
        tabBarLabelStyle: {
          fontSize: theme.typography.tiny.fontSize,
          fontWeight: theme.typography.tiny.fontWeight,
        },
      }}>
      <Tabs.Screen
        name="MapTab"
        component={MapRoute}
        options={{
          title: t('map.title'),
          tabBarIcon: MapTabIcon,
        }}
      />
      <Tabs.Screen
        name="LeaderboardTab"
        component={LeaderboardScreen}
        options={{
          title: t('leaderboard.title'),
          tabBarIcon: LeaderboardTabIcon,
        }}
      />
      <Tabs.Screen
        name="ProfileTab"
        component={ProfileScreen}
        options={{
          title: t('profile.title'),
          tabBarIcon: ProfileTabIcon,
        }}
      />
    </Tabs.Navigator>
  );
}
