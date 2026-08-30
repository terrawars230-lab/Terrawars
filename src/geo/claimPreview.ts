import type {ClaimErrorCode} from '@core/constants/errorCodes';
import {DEFAULT_GAME_CONFIG, type GameConfig} from '@core/constants/gameConfig';
import type {GpsSample, LatLng, Ring} from '@core/types/geo';

import {averageSpeedMps, cleanSamples} from './cleaning';
import {detectLoop, type LoopKind} from './loopDetection';
import {ringAreaM2, ringPerimeterM} from './measurement';
import {simplifyRing} from './simplify';

/**
 * The advisory claim preview (GR-03, GR-04, GR-05).
 *
 * ⚠️ This computes a PREVIEW, never a result. Per rule 1 of CLAUDE.md and D-05,
 * the app may show the user what they would probably get; only `finish_walk`
 * decides what they actually get. Nothing here writes anything, and a
 * `valid: true` preview can still be rejected by the server — a rival's parcel,
 * a Play Integrity verdict and the real PostGIS area are all things the client
 * cannot see.
 *
 * It exists to satisfy FR-14 (live enclosed-area estimate) and FR-18 ("Claim
 * this area?" the moment the loop closes).
 */

export interface ClaimPreview {
  /** True when every client-checkable rule in GR-04 passes. */
  valid: boolean;
  /** First failing rule, using the same codes the server returns. */
  errorCode: ClaimErrorCode | null;
  /** The candidate polygon ring, simplified for drawing. Empty when no loop is closed. */
  ring: Ring;
  /** Geodesic area of the ring, m². */
  areaM2: number;
  /** Perimeter of the ring, m². Diagnostic only — GR-05 uses the walked length. */
  perimeterM: number;
  /** Length of the whole cleaned path, m. */
  pathLengthM: number;
  durationS: number;
  averageSpeedMps: number;
  /** How the loop closed, or `null` if it has not. */
  loopKind: LoopKind | null;
  /** GR-05's ceiling, for the "you could still gain X" HUD hint. */
  maxPossibleAreaM2: number;
}

const EMPTY_PREVIEW: ClaimPreview = {
  valid: false,
  errorCode: null,
  ring: [],
  areaM2: 0,
  perimeterM: 0,
  pathLengthM: 0,
  durationS: 0,
  averageSpeedMps: 0,
  loopKind: null,
  maxPossibleAreaM2: 0,
};

export function buildClaimPreview(
  samples: readonly GpsSample[],
  config: GameConfig = DEFAULT_GAME_CONFIG,
): ClaimPreview {
  if (samples.length === 0) {
    return EMPTY_PREVIEW;
  }

  // GR-01
  const cleaned = cleanSamples(samples, config);
  const durationS = elapsedSeconds(cleaned.points);

  if (cleaned.rejection) {
    return {
      ...EMPTY_PREVIEW,
      errorCode: cleaned.rejection,
      durationS,
      pathLengthM: 0,
    };
  }

  // GR-02
  const loop = detectLoop(cleaned.points, config);
  if (!loop) {
    return {
      ...EMPTY_PREVIEW,
      errorCode: 'ERR_LOOP_NOT_CLOSED',
      durationS,
      pathLengthM: 0,
      averageSpeedMps: averageSpeedMps(cleaned.points),
    };
  }

  // GR-03 — the client cannot run ST_MakeValid, so a self-touching ring is
  // reported as an unclaimable preview and left for the server to repair. Being
  // pessimistic here is the right bias: a preview that under-promises is a
  // surprise upside, a preview that over-promises is a bug report.
  const ring = simplifyRing(loop.ring, config.simplifyToleranceM);
  // Unreachable today: detectLoop always yields >= 3 vertices and simplifyRing
  // falls back rather than degenerating. Kept as a guard so a future change to
  // either one fails as a rejected preview instead of a NaN area.
  /* istanbul ignore next -- defensive invariant, see comment above */
  if (ring.length < 3) {
    return {
      ...EMPTY_PREVIEW,
      errorCode: 'ERR_LOOP_NOT_CLOSED',
      durationS,
      pathLengthM: loop.pathLengthM,
      loopKind: loop.kind,
    };
  }

  const areaM2 = ringAreaM2(ring);
  const perimeterM = ringPerimeterM(ring);
  const speedMps = averageSpeedMps(cleaned.points);
  const maxPossibleAreaM2 = maxEnclosableAreaM2(loop.pathLengthM, config.isoperimetricTolerance);

  const preview: Omit<ClaimPreview, 'valid' | 'errorCode'> = {
    ring,
    areaM2,
    perimeterM,
    pathLengthM: loop.pathLengthM,
    durationS,
    averageSpeedMps: speedMps,
    loopKind: loop.kind,
    maxPossibleAreaM2,
  };

  // GR-04 — checked in the spec's table order so the code the user sees matches
  // the code the server will send for the same walk.
  const errorCode = firstFailingRule(preview, config);

  return {...preview, valid: errorCode === null, errorCode};
}

function firstFailingRule(
  preview: Omit<ClaimPreview, 'valid' | 'errorCode'>,
  config: GameConfig,
): ClaimErrorCode | null {
  if (preview.areaM2 < config.minClaimAreaM2) {
    return 'ERR_AREA_TOO_SMALL';
  }
  if (preview.areaM2 > config.maxClaimAreaM2) {
    return 'ERR_AREA_TOO_LARGE';
  }
  if (preview.pathLengthM < config.minWalkDistanceM) {
    return 'ERR_DISTANCE_TOO_SHORT';
  }
  if (preview.durationS < config.minWalkDurationS) {
    return 'ERR_DURATION_TOO_SHORT';
  }
  if (preview.areaM2 > preview.maxPossibleAreaM2) {
    return 'ERR_IMPOSSIBLE_AREA';
  }
  if (preview.averageSpeedMps > config.maxSpeedMps) {
    return 'ERR_TOO_FAST';
  }
  return null;
}

/**
 * GR-05 — the isoperimetric ceiling.
 *
 * No closed curve of perimeter L encloses more than L²/4π; that maximum is a
 * perfect circle. The tolerance is slack for GPS noise inflating the measured
 * path.
 *
 * `pathLengthM` must be the WALKED path length, not the polygon perimeter —
 * otherwise a shortcut straight across the polygon would shrink the perimeter
 * and inflate the allowance, which is precisely the fabrication this check
 * exists to catch (doc 03 §2, example E).
 */
export function maxEnclosableAreaM2(pathLengthM: number, tolerance: number): number {
  return ((pathLengthM * pathLengthM) / (4 * Math.PI)) * tolerance;
}

function elapsedSeconds(points: readonly {timestamp: number}[]): number {
  if (points.length < 2) {
    return 0;
  }
  return (points[points.length - 1]!.timestamp - points[0]!.timestamp) / 1000;
}

/**
 * Ray-casting point-in-ring test. Used to decide whether a tap landed inside a
 * parcel before asking the server for its detail sheet (FR-52).
 */
export function isPointInRing(point: LatLng, ring: readonly LatLng[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    const straddles = a.lat > point.lat !== b.lat > point.lat;
    if (straddles) {
      const crossingLng = ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
      if (point.lng < crossingLng) {
        inside = !inside;
      }
    }
  }
  return inside;
}
