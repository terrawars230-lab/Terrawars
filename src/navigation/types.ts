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

export type MainTabParamList = {
  MapTab: {
    /** FR-42: a raid push deep-links to the spot that was taken. */
    focus?: LatLng;
    parcelId?: string;
  };
  LeaderboardTab: undefined;
  ProfileTab: undefined;
};

/**
 * The verdict `finish_walk` returned, carried to the result screen.
 *
 * The screen re-reads the claim from the server by id (so a restored app shows
 * the real outcome), but a rejection can arrive with no claim id, and a
 * re-read can fail on the same flaky connection the claim went up on. This is
 * what it shows then, instead of a spinner or a misleading "no claim".
 */
export interface ClaimSummary {
  status: 'accepted' | 'rejected';
  errorCode: string | null;
  netAreaGainM2: number;
  stolenAreaM2: number;
  distanceM: number;
  durationS: number;
}

export type RootStackParamList = {
  // Auth flow
  Onboarding: undefined;
  SignIn: undefined;
  SignUp: undefined;
  /** FR-01: the emailed 6-digit code that confirms a new account. */
  ConfirmEmail: {email: string};

  // FR-01 password recovery, by emailed code rather than a deep link.
  ForgotPassword: undefined;
  VerifyOtp: {email: string};
  ResetPassword: undefined;

  // Post-auth gates
  ChooseUsername: undefined;
  LocationRationale: {
    /** Where to go once permission is resolved, granted or not. */
    returnTo?: 'ActiveWalk' | 'MainTabs';
  };

  MainTabs: NavigatorScreenParams<MainTabParamList>;

  // No params: the walk id is assigned by the server in startWalk() and lives
  // in the walk store. A route param would be a second, stale copy of it.
  ActiveWalk: undefined;
  ClaimResult: {claimId: string | null; summary?: ClaimSummary};
  ParcelDetail: {parcelId: string};
  PublicProfile: {username: string};
  Settings: undefined;
  /** doc 06 §7: shown before the first walk, and from settings. */
  SafetyNotice: {continueToWalk?: boolean};
  /** doc 06 §8.2: OEM battery-killer guidance (Android). */
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
