import {useCallback, useEffect, useRef, useState} from 'react';

import {useFocusEffect} from '@react-navigation/native';

import {createLogger} from '@core/logger/logger';
import type {LatLng} from '@core/types/geo';
import {locationTracker} from '@services/location/nativeWalkTracker';
import {checkLocationPermission} from '@services/permissions/permissions';

/**
 * The user's own position, for the map's blue dot and "centre on me" (FR-53).
 *
 * The map cannot just set `showsUserLocation` and hope. On Android that prop is
 * a no-op until ACCESS_FINE_LOCATION is actually granted at runtime, so a map
 * that never checks shows an empty map with no dot and no explanation — which
 * is exactly what it looked like. This hook makes the permission state
 * something the screen can render rather than something it assumes.
 *
 * It re-checks on focus because the grant happens on a *different* screen: the
 * user leaves for the FR-10 rationale modal, allows there, and comes back. A
 * mount-only check would miss that and leave the map dotless until a restart.
 *
 * It never calls `request()` itself — doc 06 §5 requires the rationale first,
 * and on Android a second denial is permanent.
 */

const logger = createLogger('user-location');

export type LocationAvailability =
  /** Still reading the permission state. */
  | 'checking'
  /** Granted — the blue dot can be enabled. */
  | 'granted'
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
  /** Takes a fresh fix. Resolves null when there is no permission or no fix. */
  locate: () => Promise<LatLng | null>;
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
    const outcome = await checkLocationPermission();
    if (!mounted.current) {
      return null;
    }

    if (outcome !== 'granted') {
      setAvailability(outcome === 'blocked' ? 'blocked' : 'needs-permission');
      return null;
    }

    setAvailability('granted');
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
        const outcome = await checkLocationPermission();
        if (cancelled || !mounted.current) {
          return;
        }

        if (outcome === 'granted') {
          setAvailability('granted');
          void locate();
        } else if (outcome === 'blocked') {
          setAvailability('blocked');
        } else if (outcome === 'unavailable') {
          setAvailability('unavailable');
        } else {
          setAvailability('needs-permission');
        }
      })();

      return () => {
        cancelled = true;
      };
    }, [locate]),
  );

  return {availability, position, isLocating, locate};
}
