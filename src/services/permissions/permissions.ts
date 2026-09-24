import {Platform} from 'react-native';

import {
  PERMISSIONS,
  RESULTS,
  check,
  checkLocationAccuracy,
  openSettings,
  request,
  requestLocationAccuracy,
  requestMultiple,
  requestNotifications,
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
 *
 * The motion / activity-recognition request that used to live here is gone
 * until the doc 06 §2 step-counter cross-check actually exists: both stores
 * reject a permission requested for a feature the app does not have.
 */

const logger = createLogger('permissions');

export type PermissionOutcome =
  | 'granted'
  /**
   * Location only: granted, but coarse (Android 12+ "approximate") or reduced
   * accuracy (iOS 14+). A fix kilometres wide cannot trace a walk, so it is
   * handled as its own state rather than as a grant.
   */
  | 'approximate'
  | 'denied'
  /** Cannot be requested again in-app; the user must go to Settings. */
  | 'blocked'
  | 'unavailable';

/**
 * iOS: the key into `NSLocationTemporaryUsageDescriptionDictionary` in
 * Info.plist, whose text explains why precise location is needed for a walk.
 */
const IOS_ACCURACY_PURPOSE_KEY = 'WalkTracking';

const ANDROID_FINE = PERMISSIONS.ANDROID.ACCESS_FINE_LOCATION;
const ANDROID_COARSE = PERMISSIONS.ANDROID.ACCESS_COARSE_LOCATION;
const IOS_WHEN_IN_USE = PERMISSIONS.IOS.LOCATION_WHEN_IN_USE;

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

/** Reads the location grant without prompting. */
export async function checkLocationPermission(): Promise<PermissionOutcome> {
  try {
    if (Platform.OS === 'android') {
      const fine = await check(ANDROID_FINE);
      if (fine === RESULTS.GRANTED) {
        return 'granted';
      }
      // The user picked "approximate" in the Android 12+ dialog.
      if ((await check(ANDROID_COARSE)) === RESULTS.GRANTED) {
        return 'approximate';
      }
      return toOutcome(fine);
    }

    const status = await check(IOS_WHEN_IN_USE);
    if (status !== RESULTS.GRANTED) {
      return toOutcome(status);
    }
    return (await iosAccuracy()) === 'reduced' ? 'approximate' : 'granted';
  } catch (error) {
    logger.warn('Could not read the location permission', {error: String(error)});
    return 'unavailable';
  }
}

/**
 * Requests location.
 *
 * Call this ONLY from the rationale screen, never speculatively on app start.
 *
 * Android asks for FINE and COARSE together: from Android 12 the system can
 * ignore a request for FINE on its own, and the dialog it shows is the one
 * that offers the precise/approximate choice. On iOS a grant with "Precise
 * Location" switched off is followed by a request for temporary full accuracy
 * for the walk — the purpose string explains why.
 */
export async function requestLocationPermission(): Promise<PermissionOutcome> {
  try {
    let outcome: PermissionOutcome;

    if (Platform.OS === 'android') {
      const statuses = await requestMultiple([ANDROID_FINE, ANDROID_COARSE]);
      if (statuses[ANDROID_FINE] === RESULTS.GRANTED) {
        outcome = 'granted';
      } else if (statuses[ANDROID_COARSE] === RESULTS.GRANTED) {
        outcome = 'approximate';
      } else {
        outcome = toOutcome(statuses[ANDROID_FINE]);
      }
    } else {
      const status = await request(IOS_WHEN_IN_USE);
      if (status !== RESULTS.GRANTED) {
        outcome = toOutcome(status);
      } else {
        let accuracy = await iosAccuracy();
        if (accuracy === 'reduced') {
          accuracy = await requestIosFullAccuracy();
        }
        outcome = accuracy === 'reduced' ? 'approximate' : 'granted';
      }
    }

    logger.info('Location permission resolved', {outcome});
    return outcome;
  } catch (error) {
    logger.warn('Location permission request failed', {error: String(error)});
    return 'unavailable';
  }
}

/**
 * iOS 14+ accuracy authorisation. A failure to read it is treated as full
 * accuracy: this is a refinement of a grant we already hold, and it must never
 * be the reason a walk cannot start.
 */
async function iosAccuracy(): Promise<'full' | 'reduced'> {
  try {
    return await checkLocationAccuracy();
  } catch {
    return 'full';
  }
}

async function requestIosFullAccuracy(): Promise<'full' | 'reduced'> {
  try {
    return await requestLocationAccuracy({purposeKey: IOS_ACCURACY_PURPOSE_KEY});
  } catch (error) {
    logger.warn('Could not request full location accuracy', {error: String(error)});
    return 'reduced';
  }
}

/**
 * Android 13+: asks, once ever, to show notifications.
 *
 * The FR-11 walk notification only needs it to be *visible* — the foreground
 * service records either way — so a refusal costs nothing and is never asked
 * about again. Called from the location rationale, right after the location
 * grant, so the two dialogs arrive with the one explanation. Not requested on
 * iOS: nothing there posts a notification yet.
 */
export async function requestWalkNotificationsOnce(): Promise<void> {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) {
    return;
  }
  if (storage.getBoolean(StorageKeys.notificationPermissionAsked)) {
    return;
  }

  // Written before asking: whatever happens next, we asked.
  storage.setBoolean(StorageKeys.notificationPermissionAsked, true);
  try {
    await requestNotifications(['alert']);
  } catch (error) {
    logger.warn('Notification permission request failed', {error: String(error)});
  }
}

/** Opens the OS settings page, for the `blocked` and `approximate` cases. */
export async function openAppSettings(): Promise<void> {
  try {
    await openSettings();
  } catch {
    logger.warn('Could not open the settings app');
  }
}
