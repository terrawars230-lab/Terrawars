import React from 'react';

import {createBottomTabNavigator} from '@react-navigation/bottom-tabs';
import {createNativeStackNavigator} from '@react-navigation/native-stack';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';

import {ErrorBoundary, Icon, Loader} from '@components/index';
import {queryKeys} from '@core/constants/queryKeys';
import {useTheme} from '@core/theme/ThemeProvider';
import {ChooseUsernameScreen} from '@features/auth/screens/ChooseUsernameScreen';
import {SignInScreen} from '@features/auth/screens/SignInScreen';
import {SignUpScreen} from '@features/auth/screens/SignUpScreen';
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
import {ClaimResultScreen} from '@features/walk/screens/ClaimResultScreen';

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

const MapTabIcon = ({color, size}: TabIconProps) => <Icon name="map" color={color} size={size} />;
const LeaderboardTabIcon = ({color, size}: TabIconProps) => (
  <Icon name="trophy" color={color} size={size} />
);
const ProfileTabIcon = ({color, size}: TabIconProps) => (
  <Icon name="user" color={color} size={size} />
);

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

export function RootNavigator(): React.JSX.Element {
  const status = useAuthStore(state => state.status);

  // The auth store restores the session from storage before this resolves, so
  // a returning user goes straight to the map with no sign-in flash (FR-07).
  if (status === 'initialising') {
    return <Loader />;
  }

  if (status === 'signedOut') {
    return <AuthStack />;
  }

  return <AuthenticatedStack />;
}

function AuthStack(): React.JSX.Element {
  return (
    <RootStack.Navigator screenOptions={{headerShown: false}}>
      <RootStack.Screen name="Onboarding" component={OnboardingScreen} />
      <RootStack.Screen name="SignUp" component={SignUpScreen} />
      <RootStack.Screen name="SignIn" component={SignInScreen} />
    </RootStack.Navigator>
  );
}

function AuthenticatedStack(): React.JSX.Element {
  const {t} = useTranslation();
  const theme = useTheme();

  // FR-02: the username gate. `needs_username` is computed server-side in
  // get_me() rather than inferred from a local flag, so a user who signed up on
  // another device is still prompted exactly once.
  const {data: profile, isLoading} = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: fetchMyProfile,
    staleTime: 60_000,
  });

  if (isLoading) {
    return <Loader />;
  }

  if (profile?.needsUsername) {
    return (
      <RootStack.Navigator screenOptions={{headerShown: false}}>
        <RootStack.Screen name="ChooseUsername" component={ChooseUsernameScreen} />
      </RootStack.Navigator>
    );
  }

  return (
    <RootStack.Navigator
      screenOptions={{
        headerShown: false,
        contentStyle: {backgroundColor: theme.colors.background},
      }}>
      <RootStack.Screen name="MainTabs" component={MainTabs} />

      {/*
        The walk screen is its own boundary. A crash in the map renderer during
        an active walk must not take the recorder down with it — the walk lives
        in a store and on disk (FR-15), so remounting this subtree is
        recoverable rather than a lost walk.
      */}
      <RootStack.Screen name="ActiveWalk">
        {() => (
          <ErrorBoundary scope="walk">
            <ActiveWalkScreen />
          </ErrorBoundary>
        )}
      </RootStack.Screen>

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
        options={{presentation: 'modal'}}
      />
      <RootStack.Screen
        name="ParcelDetail"
        component={ParcelDetailScreen}
        options={{presentation: 'modal', headerShown: true, title: t('parcel.area')}}
      />
      <RootStack.Screen
        name="PublicProfile"
        component={PublicProfileScreen}
        options={{headerShown: true, title: ''}}
      />
      <RootStack.Screen
        name="Settings"
        component={SettingsScreen}
        options={{headerShown: true, title: t('settings.title')}}
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
        tabBarActiveTintColor: theme.colors.accent,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        // NFR-10: tab labels must scale with the system font size.
        tabBarLabelStyle: {fontSize: theme.typography.caption.fontSize},
      }}>
      <Tabs.Screen
        name="MapTab"
        options={{
          title: t('map.title'),
          tabBarIcon: MapTabIcon,
        }}
        // Its own boundary for the same reason as the walk screen: the map is
        // the most complex renderer in the app and the most likely to throw.
        children={() => (
          <ErrorBoundary scope="map">
            <MapScreen />
          </ErrorBoundary>
        )}
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
