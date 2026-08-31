/**
 * Every persisted key in one place.
 *
 * Namespaced by domain and versioned where the stored shape can change, so a
 * schema change is a key change and stale data is orphaned rather than
 * misparsed.
 */
export const StorageKeys = {
  /** Supabase auth session. Written by the Supabase client, not by us. */
  authSession: 'auth.session.v1',

  /** Whether the user has finished the three onboarding screens (FR-07). */
  onboardingCompleted: 'onboarding.completed.v1',
  /** Whether the walk-safety notice has been acknowledged (doc 06 §7). */
  safetyNoticeAcknowledged: 'onboarding.safety.v1',
  /** Whether the OEM battery-settings guidance has been shown (doc 06 §8.2). */
  batteryGuidanceShown: 'onboarding.battery.v1',
  /**
   * Whether the motion/activity permission has ever been requested.
   *
   * doc 06 §2 makes a motion denial a soft anti-cheat flag, never a blocked
   * walk — so re-prompting on every walk start is friction that buys nothing.
   * Asked once, then never again from the app.
   */
  motionPermissionAsked: 'permissions.motionAsked.v1',

  /** Cached `game_config` snapshot, so a cold offline start still has tunables. */
  gameConfig: 'game.config.v1',

  /** The in-progress walk, written on every sample for crash recovery (FR-15). */
  activeWalk: 'walk.active.v2',
  /** Claims recorded offline and awaiting submission (FR-20). */
  pendingClaims: 'walk.pendingClaims.v1',

  /** User preferences that must survive a signed-out state. */
  preferredLocale: 'prefs.locale.v1',
  notificationPrefs: 'prefs.notifications.v1',
  mapShowOnlyMine: 'prefs.map.onlyMine.v1',
  hideWalkStart: 'prefs.privacy.hideWalkStart.v1',
} as const;

export type StorageKey = (typeof StorageKeys)[keyof typeof StorageKeys];
