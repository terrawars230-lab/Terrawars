import {Platform} from 'react-native';

import {
  PERMISSIONS,
  RESULTS,
  check,
  checkNotifications,
  openSettings,
  request,
  requestNotifications,
  type Permission,
  type PermissionStatus,
} from 'react-native-permissions';

import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';

/**
 * Runtime permissions (doc 06 §5).
 *
 * The rule this module exists to enforce: **the full-screen rationale is shown
 * BEFORE the system dialog, always.** doc 06 §5 calls a context-free permission
 * request both a Play policy risk and the main cause of first-session
 * drop-off — and on Android you only get one chance, because a second denial is
 * permanent.
 *
 * So nothing here calls `request()` on its own. Screens navigate to the
 * rationale, and the rationale calls `requestLocationPermission`.
 *
 * ACCESS_BACKGROUND_LOCATION is deliberately absent (ADR D-04, CLAUDE.md
 * rule 5). Do not add it here without the project owner's decision.
 */

const logger = createLogger('permissions');

export type PermissionOutcome =
  | 'granted'
  | 'denied'
  /** Cannot be requested again in-app; the user must go to Settings. */
  | 'blocked'
  | 'unavailable';

const LOCATION_PERMISSION: Permission = Platform.select({
  ios: PERMISSIONS.IOS.LOCATION_WHEN_IN_USE,
  android: PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
  default: PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION,
});

/** doc 06 §2: the step-counter cross-check, the strongest cheap anti-cheat signal. */
const MOTION_PERMISSION: Permission = Platform.select({
  ios: PERMISSIONS.IOS.MOTION,
  android: PERMISSIONS.ANDROID.ACTIVITY_RECOGNITION,
  default: PERMISSIONS.ANDROID.ACTIVITY_RECOGNITION,
});

function toOutcome(status: PermissionStatus): PermissionOutcome {
  switch (status) {
    case RESULTS.GRANTED:
    case RESULTS.LIMITED:
      return 'granted';
    case RESULTS.DENIED:
      return 'denied';
    case RESULTS.BLOCKED:
      return 'blocked';
    default:
      return 'unavailable';
  }
}

export async function checkLocationPermission(): Promise<PermissionOutcome> {
  return toOutcome(await check(LOCATION_PERMISSION));
}

/**
 * Requests location.
 *
 * Call this ONLY from the rationale screen, never speculatively on app start.
 */
export async function requestLocationPermission(): Promise<PermissionOutcome> {
  const outcome = toOutcome(await request(LOCATION_PERMISSION));
  logger.info('Location permission resolved', {outcome});
  return outcome;
}

/**
 * Requests motion/activity recognition.
 *
 * A denial is NOT a blocker. doc 06 §2 is explicit that a low step count is a
 * flag, not an auto-rejection: a phone in a bag or on a stroller handle
 * produces odd counts, and some devices have no sensor at all. Refusing to
 * record a walk over this would punish honest users to inconvenience cheats.
 */
export async function requestMotionPermission(): Promise<PermissionOutcome> {
  try {
    return toOutcome(await request(MOTION_PERMISSION));
  } catch {
    logger.warn('Motion permission is unavailable on this device');
    return 'unavailable';
  }
}

/**
 * Requests motion at most once in the app's lifetime.
 *
 * The walk flow runs before every walk, and a system dialog on every walk start
 * is the kind of friction that gets an app uninstalled. Because a denial is
 * only ever a soft flag (doc 06 §2), asking again buys nothing: a user who said
 * no once is not going to be talked round by the same dialog on Tuesday.
 *
 * Already-granted is not re-requested either — `request()` on a granted
 * permission returns immediately, but going near it costs a bridge round trip
 * on a screen that is trying to start recording.
 */
export async function requestMotionPermissionOnce(): Promise<PermissionOutcome> {
  if (storage.getBoolean(StorageKeys.motionPermissionAsked) === true) {
    return check(MOTION_PERMISSION).then(toOutcome).catch(() => 'unavailable' as const);
  }

  const outcome = await requestMotionPermission();
  // Written whatever the answer — the point is that we asked, not what was said.
  storage.setBoolean(StorageKeys.motionPermissionAsked, true);
  return outcome;
}

/** FR-70/FR-72: Android 13+ needs an explicit notification permission. */
export async function requestNotificationPermission(): Promise<PermissionOutcome> {
  const {status} = await requestNotifications(['alert', 'sound', 'badge']);
  return toOutcome(status);
}

export async function checkNotificationPermission(): Promise<PermissionOutcome> {
  const {status} = await checkNotifications();
  return toOutcome(status);
}

/** Opens the OS settings page, for the `blocked` case. */
export async function openAppSettings(): Promise<void> {
  try {
    await openSettings();
  } catch {
    logger.warn('Could not open the settings app');
  }
}

/**
 * Whether a walk can be recorded right now.
 *
 * Location is required; motion and notifications are not. Encoding that here
 * stops a screen from accidentally gating play on an optional permission.
 */
export async function canRecordWalk(): Promise<boolean> {
  return (await checkLocationPermission()) === 'granted';
}
