import type {LatLng} from '@core/types/geo';

import {toLocalPlane} from './measurement';

/**
 * GR-03(4) — Douglas–Peucker simplification with a metre tolerance.
 *
 * Two jobs, both load-bearing:
 *  - performance: NFR-03 wants 45 fps with 500 parcels in the viewport, and a
 *    raw GPS ring is an order of magnitude more vertices than the screen can
 *    resolve;
 *  - privacy: doc 06 §4.4 calls the 3 m tolerance a privacy feature — it blurs
 *    exactly where on a street someone walked.
 *
 * Works in the local metre plane so the tolerance means the same thing at every
 * latitude. A tolerance expressed in degrees would be ~2× stricter in Lahore
 * than in Oslo.
 */
export function simplifyPath(points: readonly LatLng[], toleranceM: number): LatLng[] {
  if (points.length <= 2 || toleranceM <= 0) {
    return [...points];
  }

  const origin = points[0]!;
  const planar = points.map(point => toLocalPlane(point, origin));
  const keep = new Uint8Array(planar.length);
  keep[0] = 1;
  keep[planar.length - 1] = 1;

  simplifySegment(planar, 0, planar.length - 1, toleranceM, keep);

  const result: LatLng[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) {
      result.push(points[i]!);
    }
  }
  return result;
}

/**
 * Simplifies a closed ring.
 *
 * A ring cannot be simplified as an open path: Douglas–Peucker pins the first
 * and last vertices, and on a ring those are neighbours, so the segment they
 * anchor is meaningless. Splitting at the vertex farthest from the start gives
 * two open halves whose endpoints are genuinely far apart, which is what the
 * algorithm is built for.
 */
export function simplifyRing(ring: readonly LatLng[], toleranceM: number): LatLng[] {
  if (ring.length <= 4 || toleranceM <= 0) {
    return [...ring];
  }

  const origin = ring[0]!;
  const planar = ring.map(point => toLocalPlane(point, origin));

  let splitIndex = 0;
  let maxDistanceSq = -1;
  for (let i = 1; i < planar.length; i++) {
    const dx = planar[i]!.x;
    const dy = planar[i]!.y;
    const distanceSq = dx * dx + dy * dy;
    if (distanceSq > maxDistanceSq) {
      maxDistanceSq = distanceSq;
      splitIndex = i;
    }
  }

  const firstHalf = simplifyPath(ring.slice(0, splitIndex + 1), toleranceM);
  const secondHalf = simplifyPath([...ring.slice(splitIndex), ring[0]!], toleranceM);

  // Drop the duplicated split vertex and the duplicated closing vertex —
  // app-side rings are open by convention.
  const merged = [...firstHalf, ...secondHalf.slice(1, -1)];

  // A simplified ring below 3 vertices is not a polygon. Fall back rather than
  // hand a degenerate ring to the caller (mirrors GR-03(5)).
  return merged.length >= 3 ? merged : [...ring];
}

/**
 * Recursive Douglas–Peucker over an index range, marking survivors in `keep`.
 *
 * Iterative via an explicit stack: a 4-hour walk at 5 m sampling is ~5 000
 * points, and a pathological path could recurse deep enough to blow the JS
 * stack on a low-end device.
 */
function simplifySegment(
  points: readonly {x: number; y: number}[],
  startIndex: number,
  endIndex: number,
  toleranceM: number,
  keep: Uint8Array,
): void {
  const stack: [number, number][] = [[startIndex, endIndex]];
  const toleranceSq = toleranceM * toleranceM;

  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    if (last <= first + 1) {
      continue;
    }

    let farthestIndex = -1;
    let farthestDistanceSq = 0;

    for (let i = first + 1; i < last; i++) {
      const distanceSq = perpendicularDistanceSq(points[i]!, points[first]!, points[last]!);
      if (distanceSq > farthestDistanceSq) {
        farthestDistanceSq = distanceSq;
        farthestIndex = i;
      }
    }

    if (farthestDistanceSq > toleranceSq && farthestIndex !== -1) {
      keep[farthestIndex] = 1;
      stack.push([first, farthestIndex], [farthestIndex, last]);
    }
  }
}

/** Squared perpendicular distance from `point` to the segment `start`→`end`. */
function perpendicularDistanceSq(
  point: {x: number; y: number},
  start: {x: number; y: number},
  end: {x: number; y: number},
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq === 0) {
    const px = point.x - start.x;
    const py = point.y - start.y;
    return px * px + py * py;
  }

  // Clamped projection: a vertex beyond either end of the segment measures to
  // the nearer endpoint, not to the infinite line through it.
  let t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const projectedX = start.x + t * dx;
  const projectedY = start.y + t * dy;
  const px = point.x - projectedX;
  const py = point.y - projectedY;
  return px * px + py * py;
}
