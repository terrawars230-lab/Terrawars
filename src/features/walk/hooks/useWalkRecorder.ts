import {useCallback, useEffect, useRef} from 'react';

import {useTranslation} from 'react-i18next';

import {WALK_LIMITS} from '@core/constants/gameConfig';
import {createLogger} from '@core/logger/logger';
import {formatDistance, formatDuration} from '@core/utils/format';
import {locationTracker} from '@services/location/nativeWalkTracker';
import type {TrackingStopReason} from '@services/location/types';

import {
  abandonWalk,
  finishWalk,
  startWalk,
  uploadPoints,
  type FinishWalkResult,
} from '../api/walkApi';
import {enqueueClaim} from '../services/claimQueue';
import {useWalkStore} from '../store/walkStore';

/**
 * Drives one walk from start to claim.
 *
 * Responsibilities, in the order they matter:
 *
 *  1. subscribe to the native sample stream and push every point into the store
 *     (which persists it immediately — FR-15);
 *  2. flush buffered points to the server every ~30 s (doc 05 §2);
 *  3. enforce the FR-19 hard caps;
 *  4. finish the walk, queueing the claim if the device is offline (FR-20).
 *
 * It owns no state of its own — the store is the single source of truth, so a
 * remount (a screen rotation, a navigation) cannot lose a walk in progress.
 */

const logger = createLogger('walk-recorder');

/** How often the foreground-service notification text is refreshed (FR-11). */
const NOTIFICATION_REFRESH_MS = 10_000;

export interface UseWalkRecorder {
  start: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /** Ends the walk and submits a claim. Never throws for a rule rejection. */
  finish: () => Promise<FinishWalkResult | 'queued'>;
  /** FR-17: ends without claiming. */
  discard: () => Promise<void>;
}

export function useWalkRecorder(options?: {
  onAutoEnd?: (reason: 'distance' | 'duration') => void;
  onTrackerStopped?: (reason: TrackingStopReason) => void;
  /**
   * The platform is reporting a poor fix (doc 06 §8.3). Drives the "weak GPS"
   * hint, so a user watching a stalled distance readout is told why rather
   * than left to conclude the app is broken.
   */
  onAccuracyDegraded?: (accuracyM: number) => void;
}): UseWalkRecorder {
  const {t} = useTranslation();
  const uploadTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Held in a ref so the effect below does not re-subscribe on every render;
  // resubscribing mid-walk would drop samples in the gap.
  const callbacks = useRef(options);
  callbacks.current = options;

  // ── Native sample stream ─────────────────────────────────────────────────
  useEffect(() => {
    const unsubscribeSample = locationTracker.on('sample', sample => {
      const store = useWalkStore.getState();
      store.addSample(sample);

      // FR-19: hard caps of 4 hours and 25 km, checked as points arrive rather
      // than on a timer so the walk ends at the boundary, not 30 s past it.
      const elapsedMs = store.elapsedSeconds() * 1000;
      if (elapsedMs > WALK_LIMITS.maxDurationMs) {
        callbacks.current?.onAutoEnd?.('duration');
      } else if (useWalkStore.getState().distanceM > WALK_LIMITS.maxDistanceM) {
        callbacks.current?.onAutoEnd?.('distance');
      }
    });

    const unsubscribeStopped = locationTracker.on('stopped', reason => {
      // doc 06 §8.2: an OEM battery killer stopping the service mid-walk is the
      // expected case on Xiaomi/Oppo/Vivo, not an exceptional one. The walk
      // stays in the store and on disk so the user can still claim it.
      if (reason !== 'user') {
        logger.warn('Tracking stopped unexpectedly', {reason});
        useWalkStore.getState().pause();
      }
      callbacks.current?.onTrackerStopped?.(reason);
    });

    const unsubscribeError = locationTracker.on('error', message => {
      logger.error('Location error during a walk', new Error(message));
    });

    const unsubscribeAccuracy = locationTracker.on('accuracyDegraded', accuracyM => {
      callbacks.current?.onAccuracyDegraded?.(accuracyM);
    });

    return () => {
      unsubscribeSample();
      unsubscribeStopped();
      unsubscribeError();
      unsubscribeAccuracy();
    };
  }, []);

  // ── Periodic point upload (doc 05 §2) ────────────────────────────────────
  const flushPoints = useCallback(async (): Promise<void> => {
    const store = useWalkStore.getState();
    const {walkId} = store;
    const pending = store.pendingSamples();

    if (!walkId || pending.length === 0) {
      return;
    }

    try {
      const batch = pending.slice(0, WALK_LIMITS.pointUploadBatchSize);
      await uploadPoints(walkId, batch);
      store.markUploaded(batch[batch.length - 1]!.seq);
    } catch {
      // NFR-08: a failed upload is not a failed walk. Points stay in the store
      // and on disk, and the next flush — or the offline queue at finish time —
      // sends them.
      logger.warn('Point upload failed; will retry', {pending: pending.length});
    }
  }, []);

  useEffect(() => {
    uploadTimer.current = setInterval(() => {
      void flushPoints();
    }, WALK_LIMITS.pointUploadIntervalMs);

    return () => {
      if (uploadTimer.current) {
        clearInterval(uploadTimer.current);
        uploadTimer.current = null;
      }
    };
  }, [flushPoints]);

  // ── Keep the Android notification live (FR-11) ───────────────────────────
  useEffect(() => {
    const interval = setInterval(() => {
      const store = useWalkStore.getState();
      if (store.phase !== 'recording') {
        return;
      }

      const distance = formatDistance(store.distanceM);
      const duration = formatDuration(store.elapsedSeconds());

      // updateNotification, NOT start. Re-calling start to refresh the text
      // would tear down and re-register the location request every ten
      // seconds, resetting the sampling cadence and costing battery against
      // the NFR-01 budget for a cosmetic update.
      void locationTracker.updateNotification(
        t('walk.notificationTitle'),
        t('walk.notificationBody', {
          distance: t(distance.i18nKey, {value: distance.value}),
          duration: t(duration.i18nKey, duration.params),
        }),
      );
    }, NOTIFICATION_REFRESH_MS);

    return () => clearInterval(interval);
  }, [t]);

  // ── Controls ─────────────────────────────────────────────────────────────

  const start = useCallback(async () => {
    const clientWalkId = generateUuid();
    const {walkId} = await startWalk(clientWalkId);

    useWalkStore.getState().begin(walkId, clientWalkId);

    await locationTracker.start({
      distanceFilterM: WALK_LIMITS.samplingDistanceFilterM,
      maxIntervalMs: WALK_LIMITS.samplingMaxIntervalMs,
      notificationTitle: t('walk.notificationTitle'),
      notificationBody: t('walk.notificationBody', {distance: '0 m', duration: '00:00'}),
    });

    logger.info('Walk started');
  }, [t]);

  const pause = useCallback(async () => {
    useWalkStore.getState().pause();
    await locationTracker.pause();
  }, []);

  const resume = useCallback(async () => {
    useWalkStore.getState().resume();
    await locationTracker.resume();
  }, []);

  const finish = useCallback(async (): Promise<FinishWalkResult | 'queued'> => {
    const store = useWalkStore.getState();
    const {walkId, samples} = store;

    if (!walkId) {
      throw new Error('finish() called with no walk in progress');
    }

    useWalkStore.setState({phase: 'finishing'});
    await locationTracker.stop();

    const idempotencyKey = generateUuid();

    try {
      await flushPoints();
      const result = await finishWalk(walkId, idempotencyKey);
      store.reset();
      return result;
    } catch {
      // FR-20: offline at the end of a walk means the claim is queued and
      // submitted when connectivity returns. The full sample set goes with it,
      // because a walk recorded entirely offline has uploaded nothing yet.
      logger.warn('Could not submit the claim; queueing it');
      enqueueClaim({walkId, idempotencyKey, samples});
      store.reset();
      return 'queued';
    }
  }, [flushPoints]);

  const discard = useCallback(async () => {
    const {walkId} = useWalkStore.getState();
    await locationTracker.stop();

    if (walkId) {
      try {
        await abandonWalk(walkId);
      } catch {
        // The nightly job marks stale active walks as abandoned (doc 04 §5), so
        // a failure here self-heals. Never block the user on it.
        logger.warn('Could not mark the walk abandoned; the nightly job will');
      }
    }

    useWalkStore.getState().reset();
  }, []);

  return {start, pause, resume, finish, discard};
}

/**
 * RFC 4122 v4 UUID.
 *
 * Hand-rolled rather than pulling in `uuid`, which needs `react-native-get-
 * random-values` and a crypto polyfill. These ids are idempotency keys and
 * client-side correlation ids, never secrets — `Math.random` is the right tool
 * for the job and the wrong tool for anything security-bearing.
 */
export function generateUuid(): string {
  /* eslint-disable no-bitwise -- the RFC 4122 v4 layout is defined in bits */
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
  /* eslint-enable no-bitwise */
}
