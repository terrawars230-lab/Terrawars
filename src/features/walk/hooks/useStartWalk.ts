import {useCallback} from 'react';

import {useNavigation} from '@react-navigation/native';

import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import {checkLocationPermission} from '@services/permissions/permissions';

import {useWalkStore} from '../store/walkStore';

/**
 * Every route into a walk goes through here, so the gates are applied in one
 * order everywhere:
 *
 *  1. a walk already running — or one interrupted and still on disk (FR-15) —
 *     is returned to, never started over;
 *  2. the doc 06 §7 "walk safely" notice, the first time;
 *  3. the FR-10 location rationale, whenever there is no precise grant — the
 *     only screen allowed to raise the system dialog (doc 06 §5);
 *  4. the walk.
 */
export function useStartWalk(): () => void {
  const navigation = useNavigation();

  return useCallback(() => {
    void (async () => {
      if (useWalkStore.getState().phase !== 'idle' || hasInterruptedWalk()) {
        navigation.navigate('ActiveWalk');
        return;
      }

      if (!storage.getBoolean(StorageKeys.safetyNoticeAcknowledged)) {
        navigation.navigate('SafetyNotice', {continueToWalk: true});
        return;
      }

      if ((await checkLocationPermission()) === 'granted') {
        navigation.navigate('ActiveWalk');
        return;
      }
      navigation.navigate('LocationRationale', {returnTo: 'ActiveWalk'});
    })();
  }, [navigation]);
}

/** FR-15: a walk the app was killed during, waiting to be resumed or discarded. */
export function hasInterruptedWalk(): boolean {
  return useWalkStore.getState().phase === 'idle' && storage.has(StorageKeys.activeWalk);
}
