import type {NavigatorScreenParams} from '@react-navigation/native';
import type {NativeStackScreenProps} from '@react-navigation/native-stack';

import type {LatLng} from '@core/types/geo';

/**
 * Navigation param lists.
 *
 * `declare global { namespace ReactNavigation }` at the bottom registers
 * RootStackParamList so `useNavigation()` is typed everywhere without each
 * call site importing and annotating it.
 */

export type AuthStackParamList = {
  Onboarding: undefined;
  SignIn: undefined;
  SignUp: undefined;
};

export type MainTabParamList = {
  MapTab: {
    /** FR-42: a raid push deep-links to the spot that was taken. */
    focus?: LatLng;
    parcelId?: string;
  };
  LeaderboardTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  // Auth flow
  Onboarding: undefined;
  SignIn: undefined;
  SignUp: undefined;

  // Post-auth gates
  ChooseUsername: undefined;
  LocationRationale: {
    /** Where to go once permission is resolved, granted or not. */
    returnTo?: 'ActiveWalk' | 'MainTabs';
  };

  MainTabs: NavigatorScreenParams<MainTabParamList>;

  ActiveWalk: {walkId: string};
  /**
   * Carries only the claim id. The result is re-read from the server rather
   * than passed through navigation params, so a backgrounded app that gets
   * restored shows the real outcome instead of a stale snapshot.
   */
  ClaimResult: {claimId: string};
  ParcelDetail: {parcelId: string};
  PublicProfile: {username: string};
  Settings: undefined;
  SafetyNotice: {dismissible?: boolean};
  BatteryGuidance: undefined;
};

export type RootScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
