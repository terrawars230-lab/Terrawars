import {toApiError} from '@core/api/errorMapping';
import {queryClient} from '@core/api/queryClient';
import {WALK_LIMITS} from '@core/constants/gameConfig';
import {queryKeys} from '@core/constants/queryKeys';
import {i18n} from '@core/i18n/index';
import {createLogger} from '@core/logger/logger';
import {onSignedOut} from '@core/session/session';
import type {GpsSample} from '@core/types/geo';
import {formatDistance, formatDuration} from '@core/utils/format';
import {generateUuid} from '@core/utils/uuid';
import {locationTracker} from '@services/location/nativeWalkTracker';
import type {TrackingOptions, TrackingStopReason} from '@services/location/types';

import {abandonWalk, finishWalk, startWalk, type FinishWalkResult} from '../api/walkApi';
import {useWalkStore, type AutoEndReason} from '../store/walkStore';

import {enqueueClaim} from './claimQueue';
import {uploadInBatches} from './pointUpload';

/**
 * Records a walk, independently of any screen.
 *
 * The native sample stream is subscribed ONCE, at app start, and every point
 * goes straight into the walk store, which persists it (FR-15). It used to be
 * subscribed by the walk screen, so a back swipe to glance at the map left the
 * foreground service recording with nobody listening — and every point
 * walked in that time was silently thrown away.
 *
 * The controls below are plain functions rather than a hook for the same
 * reason: finishing, pausing and the FR-19 caps are facts about the walk, not
 * about which screen happens to be mounted.
 */

const logger = createLogger('walk-recorder');

/** How often the foreground-service notification text is refreshed (FR-11). */
const NOTIFICATION_REFRESH_MS = 10_000;

// ── Events the UI may want to react to ─────────────────────────────────────

export type WalkRecorderEvent =
  /** FR-19: a hard cap was crossed and recording has stopped. */
  | {type: 'autoEnded'; reason: AutoEndReason}
  /** Tracking stopped without the app asking — an OEM killer, a revoked grant. */
  | {type: 'trackerStopped'; reason: TrackingStopReason}
  /** doc 06 §8.3: the platform reports a poor fix. Drives the weak-GPS hint. */
  | {type: 'accuracyDegraded'; accuracyM: number};

type WalkRecorderListener = (event: WalkRecorderEvent) => void;

const listeners = new Set<WalkRecorderListener>();

export function onWalkRecorderEvent(listener: WalkRecorderListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: WalkRecorderEvent): void {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error('A walk recorder listener threw', error, {event: event.type});
    }
  }
}

// ── The always-on part ─────────────────────────────────────────────────────

let teardown: (() => void) | null = null;
let isUploading = false;

/**
 * Starts listening to the native tracker. Called once from the app root;
 * calling it again returns the existing teardown.
 */
export function startWalkRecorderService(): () => void {
  if (teardown) {
    return teardown;
  }

  const unsubscribers = [
    locationTracker.on('sample', handleSample),
    locationTracker.on('stopped', handleTrackerStopped),
    locationTracker.on('error', message => {
      logger.error('Location error during a walk', new Error(message));
    }),
    locationTracker.on('accuracyDegraded', accuracyM => {
      emit({type: 'accuracyDegraded', accuracyM});
    }),
    // A session can end mid-walk (a sign-out, or a refresh token the server
    // stopped accepting). The walk belongs to that session: recording on into
    // an account that is no longer signed in would upload nothing, forever,
    // behind a notification that never goes away.
    onSignedOut(endWalkForSignOut),
  ];

  // doc 05 §2: buffered points go up every ~30 s, so a walk that ends offline
  // has as little as possible left to send.
  const uploadTimer = setInterval(() => {
    void flushPendingPoints();
  }, WALK_LIMITS.pointUploadIntervalMs);

  const notificationTimer = setInterval(tick, NOTIFICATION_REFRESH_MS);

  teardown = () => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    clearInterval(uploadTimer);
    clearInterval(notificationTimer);
    teardown = null;
  };
  return teardown;
}

function handleSample(sample: Omit<GpsSample, 'seq'>): void {
  const store = useWalkStore.getState();
  if (store.phase !== 'recording') {
    // FR-16 and the finishing guard: nothing is recorded while paused or
    // while the claim is being submitted.
    return;
  }

  store.addSample(sample);
  enforceHardCaps();
}

/**
 * FR-19: a walk auto-ends past four hours or 25 km.
 *
 * Checked as points arrive, so the walk ends at the boundary rather than on
 * the next timer tick, and again on the notification tick for a walker who has
 * stopped moving and is therefore producing no points.
 */
function enforceHardCaps(): void {
  const store = useWalkStore.getState();
  if (store.phase !== 'recording') {
    return;
  }

  const reason: AutoEndReason | null =
    store.elapsedSeconds() * 1000 > WALK_LIMITS.maxDurationMs
      ? 'duration'
      : store.distanceM > WALK_LIMITS.maxDistanceM
      ? 'distance'
      : null;

  if (!reason) {
    return;
  }

  logger.info('Walk reached an FR-19 cap', {reason});
  store.markAutoEnded(reason);
  void stopTrackerQuietly();
  emit({type: 'autoEnded', reason});
}

function handleTrackerStopped(reason: TrackingStopReason): void {
  if (reason !== 'user') {
    // doc 06 §8.2: an OEM battery killer stopping the service mid-walk is the
    // expected case on Xiaomi/Oppo/Vivo, not an exceptional one. The walk
    // stays in the store and on disk; pausing it keeps the HUD honest about
    // the fact that nothing is being recorded any more.
    logger.warn('Tracking stopped unexpectedly', {reason});
    useWalkStore.getState().pause();
  }
  emit({type: 'trackerStopped', reason});
}

function tick(): void {
  const store = useWalkStore.getState();
  if (store.phase !== 'recording') {
    return;
  }
  enforceHardCaps();
  if (useWalkStore.getState().phase !== 'recording') {
    return;
  }

  // updateNotification, NOT start. Re-calling start to refresh the text would
  // tear down and re-register the location request every ten seconds.
  void locationTracker.updateNotification(
    i18n.t('walk.notificationTitle'),
    notificationBody(store.distanceM, store.elapsedSeconds()),
  );
}

async function flushPendingPoints(): Promise<void> {
  const store = useWalkStore.getState();
  const {walkId} = store;
  if (isUploading || !walkId || (store.phase !== 'recording' && store.phase !== 'paused')) {
    return;
  }

  const pending = store.pendingSamples();
  if (pending.length === 0) {
    return;
  }

  isUploading = true;
  try {
    await uploadInBatches(walkId, pending, throughSeq => {
      // The walk may have been finished or discarded while a batch was in
      // flight; progress must not be written onto whatever replaced it.
      if (useWalkStore.getState().walkId === walkId) {
        useWalkStore.getState().markUploaded(throughSeq);
      }
    });
  } catch {
    // NFR-08: a failed upload is not a failed walk. The points stay in the
    // store and on disk, and the next tick — or finish — sends them.
    logger.warn('Point upload failed; will retry', {pending: pending.length});
  } finally {
    isUploading = false;
  }
}

async function endWalkForSignOut(): Promise<void> {
  if (useWalkStore.getState().phase !== 'idle') {
    await stopTrackerQuietly();
  }
  // The server walk is left active; the nightly job abandons it (doc 04 §5),
  // and the next start on this device supersedes it.
  useWalkStore.getState().reset();
}

// ── Controls ───────────────────────────────────────────────────────────────

function notificationBody(distanceM: number, elapsedSeconds: number): string {
  const distance = formatDistance(distanceM);
  const duration = formatDuration(elapsedSeconds);
  return i18n.t('walk.notificationBody', {
    distance: i18n.t(distance.i18nKey, {value: distance.value}),
    duration: i18n.t(duration.i18nKey, duration.params),
  });
}

function trackingOptions(): TrackingOptions {
  const store = useWalkStore.getState();
  const elapsedSeconds = store.elapsedSeconds();
  return {
    distanceFilterM: WALK_LIMITS.samplingDistanceFilterM,
    maxIntervalMs: WALK_LIMITS.samplingMaxIntervalMs,
    notificationTitle: i18n.t('walk.notificationTitle'),
    notificationBody: notificationBody(store.distanceM, elapsedSeconds),
    elapsedMs: elapsedSeconds * 1000,
  };
}

async function stopTrackerQuietly(): Promise<void> {
  try {
    await locationTracker.stop();
  } catch (error) {
    logger.warn('Could not stop the location tracker', {error: String(error)});
  }
}

/**
 * Starts a new walk: a server row first, then the native tracker.
 *
 * If the tracker refuses to start (permission revoked in the meantime, a
 * background-start restriction), the local walk is rolled back rather than
 * left in `recording` with nothing feeding it — a HUD ticking over a walk that
 * records nothing is worse than an error.
 */
export async function startNewWalk(): Promise<void> {
  const clientWalkId = generateUuid();
  const {walkId} = await startWalk(clientWalkId);

  useWalkStore.getState().begin(walkId, clientWalkId);

  try {
    await locationTracker.start(trackingOptions());
    logger.info('Walk started');
  } catch (error) {
    useWalkStore.getState().reset();
    // Best effort: the next start would supersede it anyway.
    abandonWalk(walkId).catch(() => {
      logger.warn('Could not abandon a walk whose tracker failed to start');
    });
    throw error;
  }
}

/** FR-16: pausing records nothing and stops the clock. */
export async function pauseWalk(): Promise<void> {
  useWalkStore.getState().pause();
  try {
    await locationTracker.pause();
  } catch (error) {
    logger.warn('Could not pause the native tracker', {error: String(error)});
  }
}

/**
 * Resumes a paused walk.
 *
 * The native tracker is restarted when it is no longer running — which is the
 * normal case for a walk recovered after the app was killed (FR-15), and for
 * one stopped by an OEM battery killer. Sending it a bare "resume" would
 * un-pause a tracker that does not exist and record nothing at all.
 */
export async function resumeWalk(): Promise<void> {
  const store = useWalkStore.getState();
  if (store.phase !== 'paused' || store.autoEndReason !== null) {
    return;
  }

  store.resume();
  try {
    const status = await locationTracker.getStatus();
    if (status.isTracking) {
      await locationTracker.resume();
    } else {
      await locationTracker.start(trackingOptions());
    }
  } catch (error) {
    useWalkStore.getState().pause();
    throw error;
  }
}

export type FinishOutcome =
  | {kind: 'resolved'; result: FinishWalkResult}
  /** FR-20: could not reach the server; the claim will be submitted later. */
  | {kind: 'queued'};

/**
 * Ends the walk and asks the server for its verdict (FR-30).
 *
 * Every pending point is uploaded BEFORE `finish_walk` runs. Calling it after
 * a single batch — as this used to — let the server judge the loop on a route
 * that was missing its end whenever more than one batch was outstanding, which
 * is exactly the walk that went through a dead zone.
 *
 * A transport failure queues the claim (FR-20). A rule rejection is a normal
 * result, not an error (doc 05 §7). Only a final answer about the walk itself —
 * it no longer exists, or was already finished — is thrown, after the local
 * copy is cleared, because there is nothing left to retry.
 */
export async function finishCurrentWalk(): Promise<FinishOutcome> {
  if (!useWalkStore.getState().beginFinishing()) {
    throw new Error('There is no walk in progress to finish');
  }

  const walkId = useWalkStore.getState().walkId!;
  await stopTrackerQuietly();

  const idempotencyKey = generateUuid();

  try {
    await uploadInBatches(walkId, useWalkStore.getState().pendingSamples(), throughSeq => {
      useWalkStore.getState().markUploaded(throughSeq);
    });
    const result = await finishWalk(walkId, idempotencyKey);

    useWalkStore.getState().reset();
    invalidateTerritoryQueries();
    return {kind: 'resolved', result};
  } catch (error) {
    const apiError = toApiError(error);

    if (apiError.isRetryable || apiError.requiresReauthentication || apiError.code === 'UNKNOWN') {
      logger.warn('Could not submit the claim; queueing it', {code: apiError.code});
      // Only what the server does not already have.
      enqueueClaim({
        walkId,
        idempotencyKey,
        samples: useWalkStore.getState().pendingSamples(),
      });
      useWalkStore.getState().reset();
      return {kind: 'queued'};
    }

    logger.warn('The walk can no longer be claimed', {code: apiError.code});
    useWalkStore.getState().reset();
    throw apiError;
  }
}

/** FR-17: ends the walk without claiming anything. */
export async function discardCurrentWalk(): Promise<void> {
  const {walkId} = useWalkStore.getState();
  await stopTrackerQuietly();
  useWalkStore.getState().reset();

  if (walkId) {
    try {
      await abandonWalk(walkId);
    } catch {
      // The nightly job marks stale active walks as abandoned (doc 04 §5), so
      // a failure here self-heals. Never block the user on it.
      logger.warn('Could not mark the walk abandoned; the nightly job will');
    }
  }
}

/**
 * Refreshes everything a resolved claim can change: the map, the player's own
 * totals and the boards (FR-32).
 */
export function invalidateTerritoryQueries(): void {
  void queryClient.invalidateQueries({queryKey: queryKeys.parcels.all});
  void queryClient.invalidateQueries({queryKey: queryKeys.profile.all});
  void queryClient.invalidateQueries({queryKey: queryKeys.leaderboards.all});
}
