import type {LatLng} from '@core/types/geo';
import {findSelfIntersection, type SelfIntersection} from '@geo/loopDetection';
import {toLocalPlane} from '@geo/measurement';

import {offsetMetres, ORIGIN} from './fixtures';

/**
 * The grid index behind `findSelfIntersection` (GR-02(b)).
 *
 * The index is a performance change and must be nothing else: the loop the
 * preview draws, and the "claim this area?" prompt (FR-18), depend on WHICH
 * crossing is found, not just whether one exists. So every case here is
 * checked against the exhaustive search the grid replaced, kept below as the
 * reference.
 */

/** The original all-pairs search, verbatim in behaviour. */
function exhaustiveSelfIntersection(path: readonly LatLng[]): SelfIntersection | null {
  const segmentCount = path.length - 1;
  if (segmentCount < 3) {
    return null;
  }
  const origin = path[0]!;

  for (let later = segmentCount - 1; later >= 2; later--) {
    const laterStart = toLocalPlane(path[later]!, origin);
    const laterEnd = toLocalPlane(path[later + 1]!, origin);

    for (let earlier = later - 2; earlier >= 0; earlier--) {
      const earlierStart = toLocalPlane(path[earlier]!, origin);
      const earlierEnd = toLocalPlane(path[earlier + 1]!, origin);

      const aDx = earlierEnd.x - earlierStart.x;
      const aDy = earlierEnd.y - earlierStart.y;
      const bDx = laterEnd.x - laterStart.x;
      const bDy = laterEnd.y - laterStart.y;
      const denominator = aDx * bDy - aDy * bDx;
      if (Math.abs(denominator) < 1e-9) {
        continue;
      }
      const originDx = laterStart.x - earlierStart.x;
      const originDy = laterStart.y - earlierStart.y;
      const tEarlier = (originDx * bDy - originDy * bDx) / denominator;
      const tLater = (originDx * aDy - originDy * aDx) / denominator;
      if (tEarlier <= 0 || tEarlier >= 1 || tLater <= 0 || tLater >= 1) {
        continue;
      }

      return {
        earlierSegmentIndex: earlier,
        laterSegmentIndex: later,
        point: {
          lat: path[earlier]!.lat + (path[earlier + 1]!.lat - path[earlier]!.lat) * tEarlier,
          lng: path[earlier]!.lng + (path[earlier + 1]!.lng - path[earlier]!.lng) * tEarlier,
        },
      };
    }
  }
  return null;
}

/** Deterministic PRNG, so a failure reproduces. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    /* eslint-disable no-bitwise -- the generator is defined in bit operations */
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    /* eslint-enable no-bitwise */
  };
}

/**
 * A wandering walk: steps of a few metres with a drifting heading, plus the
 * occasional long jump that a GPS gap produces — which exercises the
 * oversized-segment path of the index.
 */
function randomWalk(random: () => number, points: number, jumpChance: number): LatLng[] {
  const path: LatLng[] = [ORIGIN];
  let east = 0;
  let north = 0;
  let heading = random() * Math.PI * 2;

  for (let i = 1; i < points; i++) {
    heading += (random() - 0.5) * 2.4;
    const step = random() < jumpChance ? 300 + random() * 2000 : 3 + random() * 12;
    east += Math.cos(heading) * step;
    north += Math.sin(heading) * step;
    path.push(offsetMetres(ORIGIN, east, north));
  }
  return path;
}

/** An outward spiral: long, dense, and never crosses itself. */
function spiral(points: number, spacingM: number): LatLng[] {
  const path: LatLng[] = [];
  let angle = 0;
  for (let i = 0; i < points; i++) {
    const radius = 20 + angle * 6;
    path.push(offsetMetres(ORIGIN, Math.cos(angle) * radius, Math.sin(angle) * radius));
    angle += spacingM / radius;
  }
  return path;
}

function expectSameResult(path: LatLng[]): void {
  const indexed = findSelfIntersection(path);
  const reference = exhaustiveSelfIntersection(path);

  if (reference === null) {
    expect(indexed).toBeNull();
    return;
  }

  expect(indexed).not.toBeNull();
  expect(indexed!.laterSegmentIndex).toBe(reference.laterSegmentIndex);
  expect(indexed!.earlierSegmentIndex).toBe(reference.earlierSegmentIndex);
  expect(indexed!.point.lat).toBeCloseTo(reference.point.lat, 12);
  expect(indexed!.point.lng).toBeCloseTo(reference.point.lng, 12);
}

describe('findSelfIntersection — grid index', () => {
  it('agrees with the exhaustive search on hundreds of random walks', () => {
    const random = mulberry32(20260922);
    let crossings = 0;

    for (let run = 0; run < 300; run++) {
      const path = randomWalk(random, 20 + Math.floor(random() * 180), run % 3 === 0 ? 0.05 : 0);
      if (exhaustiveSelfIntersection(path)) {
        crossings++;
      }
      expectSameResult(path);
    }

    // Sanity on the fixture itself: a suite that never crossed would prove
    // nothing about WHICH crossing is chosen.
    expect(crossings).toBeGreaterThan(100);
  });

  it('agrees on the prefixes of one walk, as the incremental preview sees it', () => {
    const path = randomWalk(mulberry32(7), 400, 0.02);
    for (let length = 4; length <= path.length; length += 7) {
      expectSameResult(path.slice(0, length));
    }
  });

  it('finds a crossing made by a long GPS-gap segment', () => {
    // A 1.2 km straight jump across a square the walker already drew.
    const path = [
      offsetMetres(ORIGIN, 0, 0),
      offsetMetres(ORIGIN, 100, 0),
      offsetMetres(ORIGIN, 100, 100),
      offsetMetres(ORIGIN, 0, 100),
      offsetMetres(ORIGIN, 50, -600),
      offsetMetres(ORIGIN, 50, 600),
    ];

    expect(findSelfIntersection(path)).not.toBeNull();
    expectSameResult(path);
  });

  it('reports no crossing on a long spiral that never crosses', () => {
    const path = spiral(3000, 6);
    expect(findSelfIntersection(path)).toBeNull();
  });

  it('handles a crossing that lands exactly on a grid-cell boundary', () => {
    // 20 m cells: the crossing point sits on x = 20, y = 20.
    const path = [
      offsetMetres(ORIGIN, 0, 20),
      offsetMetres(ORIGIN, 40, 20),
      offsetMetres(ORIGIN, 40, 60),
      offsetMetres(ORIGIN, 20, 60),
      offsetMetres(ORIGIN, 20, 0),
    ];

    expect(findSelfIntersection(path)).not.toBeNull();
    expectSameResult(path);
  });
});
