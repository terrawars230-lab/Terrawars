import type {GameConfig} from '@core/constants/gameConfig';
import type {GpsSample} from '@core/types/geo';

import {haversineDistanceM} from './measurement';

/**
 * GR-01 — Point cleaning.
 *
 * A faithful client-side mirror of the server's cleaning pass, run for the live
 * HUD and the claim preview only. The server re-runs the identical sequence
 * inside `build_claim_polygon` and its verdict is the only one that counts
 * (D-05). Keeping the two in step is what stops the app from promising a claim
 * the server then rejects.
 *
 * Order matters and is fixed by the spec:
 *   1. drop accuracy > MAX_ACCURACY_M
 *   2. drop is_mock (and mark the walk suspicious)
 *   3. drop duplicate timestamps; sort strictly by timestamp
 *   4. drop points < 2 m from the previous accepted point (GPS jitter)
 *   5. speed check: one teleport is repaired, two or more reject the walk
 *   6. fewer than MIN_POINTS remaining rejects the walk
 */

/** GR-01(4). Fixed by the spec, not a `game_config` tunable. */
export const JITTER_THRESHOLD_M = 2;

export type CleaningRejection = 'ERR_TELEPORT' | 'ERR_TOO_FEW_POINTS';

export interface CleaningResult {
  /** Points surviving every filter, ordered by timestamp. */
  points: GpsSample[];
  /** Set when the walk cannot produce a claim. The walk is still saved (doc 03 §6). */
  rejection: CleaningRejection | null;
  stats: {
    inputCount: number;
    droppedForAccuracy: number;
    droppedForMock: number;
    droppedForDuplicateTime: number;
    droppedForJitter: number;
    teleportCount: number;
    /** doc 06 §3(2): a hard rejection server-side above 5%. Surfaced for telemetry. */
    mockRatio: number;
  };
}

type CleaningConfig = Pick<GameConfig, 'maxAccuracyM' | 'maxBurstSpeedMps' | 'minPoints'>;

export function cleanSamples(
  samples: readonly GpsSample[],
  config: CleaningConfig,
): CleaningResult {
  const stats: CleaningResult['stats'] = {
    inputCount: samples.length,
    droppedForAccuracy: 0,
    droppedForMock: 0,
    droppedForDuplicateTime: 0,
    droppedForJitter: 0,
    teleportCount: 0,
    mockRatio: 0,
  };

  // Steps 1 & 2 — accuracy and mock-provider filters.
  const filtered: GpsSample[] = [];
  for (const sample of samples) {
    if (sample.accuracyM !== null && sample.accuracyM > config.maxAccuracyM) {
      stats.droppedForAccuracy++;
      continue;
    }
    if (sample.isMock) {
      stats.droppedForMock++;
      continue;
    }
    filtered.push(sample);
  }
  stats.mockRatio = samples.length > 0 ? stats.droppedForMock / samples.length : 0;

  // Step 3 — strict chronological order, one point per timestamp.
  //
  // Sorting by timestamp and *then* by seq keeps the result deterministic when
  // two samples share a millisecond, which some Android providers do emit.
  const sorted = [...filtered].sort((a, b) => a.timestamp - b.timestamp || a.seq - b.seq);
  const deduped: GpsSample[] = [];
  for (const sample of sorted) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.timestamp === sample.timestamp) {
      stats.droppedForDuplicateTime++;
      continue;
    }
    deduped.push(sample);
  }

  // Steps 4 & 5 — jitter removal and teleport handling in one pass, because
  // dropping a jitter point changes which pair the speed check compares.
  const accepted: GpsSample[] = [];
  for (const sample of deduped) {
    const previous = accepted[accepted.length - 1];

    if (!previous) {
      accepted.push(sample);
      continue;
    }

    const distanceM = haversineDistanceM(previous, sample);
    if (distanceM < JITTER_THRESHOLD_M) {
      stats.droppedForJitter++;
      continue;
    }

    const elapsedS = (sample.timestamp - previous.timestamp) / 1000;
    const speedMps = elapsedS > 0 ? distanceM / elapsedS : Number.POSITIVE_INFINITY;

    if (speedMps > config.maxBurstSpeedMps) {
      // GR-01(5): drop the offending point and re-link. The next iteration
      // measures from `previous` again, so a single bad fix is repaired rather
      // than poisoning the whole remaining path.
      stats.teleportCount++;
      if (stats.teleportCount >= 2) {
        return {points: accepted, rejection: 'ERR_TELEPORT', stats};
      }
      continue;
    }

    accepted.push(sample);
  }

  if (accepted.length < config.minPoints) {
    return {points: accepted, rejection: 'ERR_TOO_FEW_POINTS', stats};
  }

  return {points: accepted, rejection: null, stats};
}

/** Average speed over the cleaned path, m/s. GR-04's `ERR_TOO_FAST` input. */
export function averageSpeedMps(points: readonly GpsSample[]): number {
  if (points.length < 2) {
    return 0;
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const elapsedS = (last.timestamp - first.timestamp) / 1000;
  if (elapsedS <= 0) {
    return Number.POSITIVE_INFINITY;
  }

  let distanceM = 0;
  for (let i = 1; i < points.length; i++) {
    distanceM += haversineDistanceM(points[i - 1]!, points[i]!);
  }
  return distanceM / elapsedS;
}
