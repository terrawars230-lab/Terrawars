import NetInfo from '@react-native-community/netinfo';

import {ApiError} from '@core/api/ApiError';
import {WALK_LIMITS} from '@core/constants/gameConfig';
import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import type {GpsSample} from '@core/types/geo';

import {finishWalk, uploadPoints, type FinishWalkResult} from '../api/walkApi';

/**
 * Offline claim queue (FR-20, NFR-08).
 *
 * "If the device is offline at the end of a walk, the claim is queued and
 * submitted automatically when connectivity returns (queue survives app
 * restart, max age 24 h)."
 *
 * The queue holds the walk's points as well as its id, because a walk recorded
 * entirely offline has never uploaded anything — the server knows only that a
 * walk row exists. Points go up first, then `finish_walk` runs.
 *
 * Idempotency is what makes retrying safe (NFR-06, GR-24): point upload upserts
 * on (walk_id, seq), and `claims.walk_id` is UNIQUE, so a walk resolves exactly
 * once no matter how many times this queue tries.
 */

const logger = createLogger('claim-queue');

export interface QueuedClaim {
  walkId: string;
  idempotencyKey: string;
  queuedAt: number;
  samples: GpsSample[];
  attempts: number;
}

type FlushListener = (walkId: string, result: FinishWalkResult) => void;

const listeners = new Set<FlushListener>();
let isFlushing = false;
let unsubscribeNetInfo: (() => void) | null = null;

function read(): QueuedClaim[] {
  return storage.getObject<QueuedClaim[]>(StorageKeys.pendingClaims) ?? [];
}

function write(queue: QueuedClaim[]): void {
  storage.setObject(StorageKeys.pendingClaims, queue);
}

/** Drops entries past the 24 h ceiling FR-20 sets. */
function withoutExpired(queue: QueuedClaim[]): QueuedClaim[] {
  const cutoff = Date.now() - WALK_LIMITS.offlineQueueMaxAgeMs;
  const live = queue.filter(entry => entry.queuedAt >= cutoff);

  if (live.length !== queue.length) {
    logger.info('Dropped expired queued claims', {dropped: queue.length - live.length});
  }
  return live;
}

export function enqueueClaim(entry: Omit<QueuedClaim, 'queuedAt' | 'attempts'>): void {
  const queue = withoutExpired(read());

  // Re-queuing the same walk replaces the entry rather than adding a second —
  // two entries for one walk would mean two finish attempts, and while the
  // server tolerates that, the user would see the result screen twice.
  const next = queue.filter(existing => existing.walkId !== entry.walkId);
  next.push({...entry, queuedAt: Date.now(), attempts: 0});

  write(next);
  logger.info('Claim queued for later submission', {queueLength: next.length});
}

export function queuedClaimCount(): number {
  return withoutExpired(read()).length;
}

export function onClaimFlushed(listener: FlushListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Attempts to submit everything queued.
 *
 * Safe to call at any time — it no-ops when offline, when the queue is empty,
 * or when a flush is already running. Returns the results it managed to
 * resolve.
 */
export async function flushQueue(): Promise<FinishWalkResult[]> {
  if (isFlushing) {
    return [];
  }

  const queue = withoutExpired(read());
  if (queue.length === 0) {
    write(queue);
    return [];
  }

  const {isConnected, isInternetReachable} = await NetInfo.fetch();
  if (!isConnected || isInternetReachable === false) {
    write(queue);
    return [];
  }

  isFlushing = true;
  const resolved: FinishWalkResult[] = [];
  const remaining: QueuedClaim[] = [];

  try {
    for (const entry of queue) {
      try {
        if (entry.samples.length > 0) {
          await uploadPointsInBatches(entry.walkId, entry.samples);
        }

        const result = await finishWalk(entry.walkId, entry.idempotencyKey);
        resolved.push(result);

        for (const listener of listeners) {
          listener(entry.walkId, result);
        }

        logger.info('Flushed a queued claim', {status: result.status});
      } catch (error) {
        const apiError = ApiError.isApiError(error) ? error : null;

        // A rule rejection is a final answer, not a transport failure — keeping
        // it queued would retry it forever against a verdict that cannot change.
        if (apiError && !apiError.isRetryable && !apiError.requiresReauthentication) {
          logger.warn('Dropping a queued claim the server refused', {code: apiError.code});
          continue;
        }

        remaining.push({...entry, attempts: entry.attempts + 1});
        logger.warn('Queued claim will be retried', {attempts: entry.attempts + 1});
      }
    }
  } finally {
    write(remaining);
    isFlushing = false;
  }

  return resolved;
}

/**
 * Uploads points in batches.
 *
 * A four-hour walk is thousands of rows; one insert that size is slow, likely
 * to time out on mobile data, and all-or-nothing. Batching means a dropped
 * connection costs one batch, and the upsert makes re-sending it free.
 */
async function uploadPointsInBatches(walkId: string, samples: readonly GpsSample[]): Promise<void> {
  const size = WALK_LIMITS.pointUploadBatchSize;
  for (let start = 0; start < samples.length; start += size) {
    await uploadPoints(walkId, samples.slice(start, start + size));
  }
}

/**
 * Flushes automatically when connectivity returns.
 *
 * Started once from the app root. Returns a teardown function.
 */
export function startQueueAutoFlush(): () => void {
  if (unsubscribeNetInfo) {
    return unsubscribeNetInfo;
  }

  const unsubscribe = NetInfo.addEventListener(state => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void flushQueue();
    }
  });

  unsubscribeNetInfo = () => {
    unsubscribe();
    unsubscribeNetInfo = null;
  };

  // Catch the case where the app launches already online with a queue waiting.
  void flushQueue();

  return unsubscribeNetInfo;
}
