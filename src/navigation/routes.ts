/**
 * Route names as constants.
 *
 * A typo in a navigate() call is a runtime crash, not a compile error, unless
 * the names are values the compiler can check. These feed the param lists in
 * `types.ts`, which is what makes navigation typed end to end.
 */
export const Routes = {
  // Pre-auth
  Onboarding: 'Onboarding',
  SignIn: 'SignIn',
  SignUp: 'SignUp',

  // Post-auth, pre-play
  ChooseUsername: 'ChooseUsername',
  LocationRationale: 'LocationRationale',

  // Main tabs
  MainTabs: 'MainTabs',
  MapTab: 'MapTab',
  LeaderboardTab: 'LeaderboardTab',
  ProfileTab: 'ProfileTab',

  // Modals and pushed screens
  ActiveWalk: 'ActiveWalk',
  ClaimResult: 'ClaimResult',
  ParcelDetail: 'ParcelDetail',
  PublicProfile: 'PublicProfile',
  Settings: 'Settings',
  SafetyNotice: 'SafetyNotice',
  BatteryGuidance: 'BatteryGuidance',
} as const;

export type RouteName = (typeof Routes)[keyof typeof Routes];
