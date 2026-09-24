import NetInfo from '@react-native-community/netinfo';

import {ApiError} from '@core/api/ApiError';
import {WALK_LIMITS} from '@core/constants/gameConfig';
import {createLogger} from '@core/logger/logger';
import {getSessionUserId} from '@core/session/session';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';
import type {GpsSample} from '@core/types/geo';

import {finishWalk, type FinishWalkResult} from '../api/walkApi';

import {uploadInBatches} from './pointUpload';

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
  /**
   * The account that recorded the walk. Only that account's session ever
   * submits it: after a sign-out and a different sign-in on the same device,
   * the previous player's walk waits for them (until the 24 h ceiling) rather
   * than being sent under someone else's session. Absent on entries queued by
   * builds that predate it.
   */
  userId?: string | null;
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

export function enqueueClaim(entry: Omit<QueuedClaim, 'queuedAt' | 'attempts' | 'userId'>): void {
  const queue = withoutExpired(read());

  // Re-queuing the same walk replaces the entry rather than adding a second —
  // two entries for one walk would mean two finish attempts, and while the
  // server tolerates that, the user would see the result screen twice.
  const next = queue.filter(existing => existing.walkId !== entry.walkId);
  next.push({...entry, userId: getSessionUserId(), queuedAt: Date.now(), attempts: 0});

  write(next);
  logger.info('Claim queued for later submission', {queueLength: next.length});
}

/** Queued claims belonging to the signed-in player (or to nobody known). */
export function queuedClaimCount(): number {
  const userId = getSessionUserId();
  return withoutExpired(read()).filter(entry => belongsTo(entry, userId)).length;
}

function belongsTo(entry: QueuedClaim, userId: string | null): boolean {
  return !entry.userId || entry.userId === userId;
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

  // Signed out, nothing can be submitted — every call would come back
  // UNAUTHENTICATED and cost a round trip each. The queue is flushed again the
  // moment a session appears.
  const userId = getSessionUserId();
  if (!userId) {
    return [];
  }

  const queue = withoutExpired(read());
  const mine = queue.filter(entry => belongsTo(entry, userId));
  if (mine.length === 0) {
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
  // Another account's entries are carried over untouched.
  const remaining: QueuedClaim[] = queue.filter(entry => !belongsTo(entry, userId));

  try {
    for (const entry of mine) {
      try {
        if (entry.samples.length > 0) {
          await uploadInBatches(entry.walkId, entry.samples);
        }

        const result = await finishWalk(entry.walkId, entry.idempotencyKey);
        resolved.push(result);

        for (const listener of listeners) {
          try {
            listener(entry.walkId, result);
          } catch (error) {
            // A listener is UI plumbing. It must never put a claim that the
            // server has already accepted back into the queue.
            logger.error('A claim-flushed listener threw', error);
          }
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
