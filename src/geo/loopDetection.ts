import type {GameConfig} from '@core/constants/gameConfig';
import type {LatLng} from '@core/types/geo';

import {haversineDistanceM, pathLengthM, toLocalPlane} from './measurement';

/**
 * GR-02 — Loop closure detection.
 *
 * A loop is closed when EITHER
 *   (a) the last point is within LOOP_CLOSE_RADIUS_M of the first AND the path
 *       has already covered MIN_WALK_DISTANCE_M; or
 *   (b) a later segment crosses an earlier one — the common real-world case,
 *       since people rarely stop on the exact metre they started. The loop is
 *       then the sub-path between the two crossing segments and everything
 *       before the intersection is discarded.
 *
 * FR-18 needs this to feel instant while walking, so `detectLoop` is written to
 * be called incrementally: `findSelfIntersection` only tests the newest segment
 * against earlier ones, which is O(n) per new point rather than O(n²) over the
 * whole path.
 */

export type LoopKind = 'return-to-start' | 'self-intersection';

export interface DetectedLoop {
  kind: LoopKind;
  /** The closed sub-path, ready to become a polygon ring (GR-03). Open — first vertex not repeated. */
  ring: LatLng[];
  /** Index into the input path where the loop begins. Points before this are discarded. */
  startIndex: number;
  /** Length of the whole walked path up to closure, metres. This — not the ring perimeter — feeds GR-05. */
  pathLengthM: number;
}

type LoopConfig = Pick<GameConfig, 'loopCloseRadiusM' | 'minWalkDistanceM'>;

/**
 * Detects loop closure over the full path.
 *
 * Self-intersection is preferred over return-to-start when both hold: it yields
 * a tighter, more accurate ring, because the return-to-start case leaves a gap
 * of up to LOOP_CLOSE_RADIUS_M that has to be bridged by a straight line.
 */
export function detectLoop(path: readonly LatLng[], config: LoopConfig): DetectedLoop | null {
  if (path.length < 4) {
    return null;
  }

  const intersection = findSelfIntersection(path);
  if (intersection) {
    // The ring runs from the start of the earlier crossed segment, through the
    // crossing point, back around. The crossing point itself is inserted at
    // both ends so the ring closes exactly rather than approximately.
    const ring = [
      intersection.point,
      ...path.slice(intersection.earlierSegmentIndex + 1, intersection.laterSegmentIndex + 1),
    ];
    return {
      kind: 'self-intersection',
      ring,
      startIndex: intersection.earlierSegmentIndex,
      pathLengthM: pathLengthM(path),
    };
  }

  const totalLengthM = pathLengthM(path);
  if (totalLengthM < config.minWalkDistanceM) {
    return null;
  }

  const first = path[0]!;
  const last = path[path.length - 1]!;
  if (haversineDistanceM(first, last) <= config.loopCloseRadiusM) {
    return {
      kind: 'return-to-start',
      ring: [...path],
      startIndex: 0,
      pathLengthM: totalLengthM,
    };
  }

  return null;
}

export interface SelfIntersection {
  /** Index of the first vertex of the earlier segment. */
  earlierSegmentIndex: number;
  /** Index of the first vertex of the later segment. */
  laterSegmentIndex: number;
  /** Where the two segments cross. */
  point: LatLng;
}

/**
 * Finds the first self-intersection in the path, scanning newest segment first.
 *
 * Scanning backwards matters for the incremental case: the crossing a walker
 * just made is at the end of the path, so it is found in the first few
 * comparisons instead of after a full quadratic sweep.
 *
 * Adjacent segments are skipped — they share a vertex by construction and would
 * otherwise report a false crossing at every single point.
 */
export function findSelfIntersection(path: readonly LatLng[]): SelfIntersection | null {
  const segmentCount = path.length - 1;
  if (segmentCount < 3) {
    return null;
  }

  // A single local plane for the whole comparison. Over a walk-sized path the
  // equirectangular error is millimetres, and working in metres keeps the
  // degenerate-segment epsilon below meaningful in a unit we can reason about.
  const origin = path[0]!;

  for (let later = segmentCount - 1; later >= 2; later--) {
    const laterStart = toLocalPlane(path[later]!, origin);
    const laterEnd = toLocalPlane(path[later + 1]!, origin);

    for (let earlier = later - 2; earlier >= 0; earlier--) {
      const earlierStart = toLocalPlane(path[earlier]!, origin);
      const earlierEnd = toLocalPlane(path[earlier + 1]!, origin);

      const hit = segmentIntersection(earlierStart, earlierEnd, laterStart, laterEnd);
      if (hit) {
        return {
          earlierSegmentIndex: earlier,
          laterSegmentIndex: later,
          point: {
            lat: path[earlier]!.lat + (path[earlier + 1]!.lat - path[earlier]!.lat) * hit.tEarlier,
            lng: path[earlier]!.lng + (path[earlier + 1]!.lng - path[earlier]!.lng) * hit.tEarlier,
          },
        };
      }
    }
  }

  return null;
}

interface PlanarPoint {
  x: number;
  y: number;
}

/** Metres. Below this the cross product is numerical noise, not a real angle. */
const PARALLEL_EPSILON = 1e-9;

/**
 * Proper segment intersection in the local metre plane.
 *
 * Returns the parametric position along each segment, or `null` when they are
 * parallel or only touch at an endpoint. Endpoint touches are excluded on the
 * open interval (0, 1) deliberately: a GPS path that doubles back through a
 * vertex it already visited is jitter, not a lap around a block.
 */
function segmentIntersection(
  a1: PlanarPoint,
  a2: PlanarPoint,
  b1: PlanarPoint,
  b2: PlanarPoint,
): {tEarlier: number; tLater: number} | null {
  const aDx = a2.x - a1.x;
  const aDy = a2.y - a1.y;
  const bDx = b2.x - b1.x;
  const bDy = b2.y - b1.y;

  const denominator = aDx * bDy - aDy * bDx;
  if (Math.abs(denominator) < PARALLEL_EPSILON) {
    return null;
  }

  const originDx = b1.x - a1.x;
  const originDy = b1.y - a1.y;

  const tEarlier = (originDx * bDy - originDy * bDx) / denominator;
  const tLater = (originDx * aDy - originDy * aDx) / denominator;

  if (tEarlier <= 0 || tEarlier >= 1 || tLater <= 0 || tLater >= 1) {
    return null;
  }

  return {tEarlier, tLater};
}
