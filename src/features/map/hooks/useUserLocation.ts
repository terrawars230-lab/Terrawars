import {useCallback, useEffect, useRef, useState} from 'react';

import {useFocusEffect} from '@react-navigation/native';

import {createLogger} from '@core/logger/logger';
import type {LatLng} from '@core/types/geo';
import {locationTracker} from '@services/location/nativeWalkTracker';
import {checkLocationPermission, type PermissionOutcome} from '@services/permissions/permissions';

/**
 * The user's own position, for the map's blue dot and "centre on me" (FR-53).
 *
 * The map cannot just set `showsUserLocation` and hope. On Android that prop is
 * a no-op until location is actually granted at runtime, so a map that never
 * checks shows an empty map with no dot and no explanation. This hook makes the
 * permission state something the screen can render rather than assume.
 *
 * It re-checks on focus because the grant happens on a *different* screen: the
 * user leaves for the FR-10 rationale modal, allows there, and comes back.
 *
 * It never calls `request()` itself — doc 06 §5 requires the rationale first,
 * and on Android a second denial is permanent.
 */

const logger = createLogger('user-location');

export type LocationAvailability =
  /** Still reading the permission state. */
  | 'checking'
  /** Precise location granted — the blue dot and walks both work. */
  | 'granted'
  /**
   * Only an approximate location. Enough for a blue dot, not for a walk; the
   * rationale screen explains and asks for precise.
   */
  | 'approximate'
  /** Not granted yet; the rationale screen is the next step. */
  | 'needs-permission'
  /** Denied permanently; only the OS settings page can undo it. */
  | 'blocked'
  /** No location hardware, or the native module is missing. */
  | 'unavailable';

export interface UseUserLocation {
  availability: LocationAvailability;
  /** The last fix we obtained, or null if none yet. */
  position: LatLng | null;
  /** True while a one-shot fix is in flight. */
  isLocating: boolean;
  /** Takes a fresh fix. Resolves null when there is no permission or no fix. Never rejects. */
  locate: () => Promise<LatLng | null>;
}

function toAvailability(outcome: PermissionOutcome): LocationAvailability {
  switch (outcome) {
    case 'granted':
      return 'granted';
    case 'approximate':
      return 'approximate';
    case 'blocked':
      return 'blocked';
    case 'unavailable':
      return 'unavailable';
    default:
      return 'needs-permission';
  }
}

/** Either grant is enough to show the user where they are. */
function canShowPosition(availability: LocationAvailability): boolean {
  return availability === 'granted' || availability === 'approximate';
}

export function useUserLocation(): UseUserLocation {
  const [availability, setAvailability] = useState<LocationAvailability>('checking');
  const [position, setPosition] = useState<LatLng | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // Guards against a fix resolving after the screen has gone.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const locate = useCallback(async (): Promise<LatLng | null> => {
    const next = toAvailability(await checkLocationPermission());
    if (!mounted.current) {
      return null;
    }

    setAvailability(next);
    if (!canShowPosition(next)) {
      return null;
    }

    setIsLocating(true);
    try {
      const sample = await locationTracker.getCurrentPosition();
      const fix: LatLng = {lat: sample.lat, lng: sample.lng};
      if (mounted.current) {
        setPosition(fix);
      }
      return fix;
    } catch (error) {
      // A missing fix is ordinary — indoors, airplane mode, a cold GPS. The
      // map stays where it is rather than throwing the user to an error state.
      logger.warn('Could not get a position fix', {error: String(error)});
      return null;
    } finally {
      if (mounted.current) {
        setIsLocating(false);
      }
    }
  }, []);

  // Re-checked on every focus: the grant happens in the rationale modal, and
  // coming back from it is the moment the dot should appear.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;

      void (async () => {
        const next = toAvailability(await checkLocationPermission());
        if (cancelled || !mounted.current) {
          return;
        }
        setAvailability(next);
        if (canShowPosition(next)) {
          void locate();
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [locate]),
  );

  return {availability, position, isLocating, locate};
}
