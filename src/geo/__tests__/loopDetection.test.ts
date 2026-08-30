import {DEFAULT_GAME_CONFIG} from '@core/constants/gameConfig';
import {detectLoop, findSelfIntersection} from '@geo/loopDetection';
import {haversineDistanceM, ringAreaM2} from '@geo/measurement';

import {
  APPROACH_POINT_COUNT,
  ORIGIN,
  approachThenLoopPath,
  densifyRing,
  figureEightPath,
  offsetMetres,
  openPath,
  squareRing,
} from './fixtures';

const config = DEFAULT_GAME_CONFIG;

describe('findSelfIntersection', () => {
  it('returns null for a path that never crosses itself', () => {
    expect(findSelfIntersection(openPath())).toBeNull();
  });

  it('returns null for paths too short to cross', () => {
    expect(findSelfIntersection([])).toBeNull();
    expect(findSelfIntersection([ORIGIN, offsetMetres(ORIGIN, 10, 0)])).toBeNull();
  });

  it('does not report adjacent segments sharing a vertex as a crossing', () => {
    // A sharp switchback: the walker doubles straight back on themselves.
    const path = [
      offsetMetres(ORIGIN, 0, 0),
      offsetMetres(ORIGIN, 100, 0),
      offsetMetres(ORIGIN, 100, 100),
      offsetMetres(ORIGIN, 100, 5),
    ];
    expect(findSelfIntersection(path)).toBeNull();
  });

  it('finds a genuine crossing and locates the point on both segments', () => {
    // A plus sign: the second stroke crosses the first at its midpoint.
    const path = [
      offsetMetres(ORIGIN, -100, 0),
      offsetMetres(ORIGIN, 100, 0),
      offsetMetres(ORIGIN, 100, -100),
      offsetMetres(ORIGIN, 0, -100),
      offsetMetres(ORIGIN, 0, 100),
    ];

    const hit = findSelfIntersection(path);
    expect(hit).not.toBeNull();
    expect(haversineDistanceM(hit!.point, ORIGIN)).toBeLessThan(1);
    expect(hit!.earlierSegmentIndex).toBeLessThan(hit!.laterSegmentIndex);
  });

  it('finds the crossing in a figure-eight', () => {
    expect(findSelfIntersection(figureEightPath())).not.toBeNull();
  });

  it('does not report parallel overlapping segments', () => {
    // A walker retracing the same street: collinear, never properly crossing.
    const path = [
      offsetMetres(ORIGIN, 0, 0),
      offsetMetres(ORIGIN, 200, 0),
      offsetMetres(ORIGIN, 400, 0),
      offsetMetres(ORIGIN, 600, 0),
    ];
    expect(findSelfIntersection(path)).toBeNull();
  });
});

describe('detectLoop — GR-02', () => {
  it('reports no loop for an open path', () => {
    expect(detectLoop(openPath(), config)).toBeNull();
  });

  it('(a) closes on return-to-start inside LOOP_CLOSE_RADIUS_M', () => {
    const ring = densifyRing(squareRing(250), 10);
    // End 12 m from the start — inside the 30 m radius, as in doc 03 example A.
    const path = [...ring, offsetMetres(ORIGIN, 0, 12)];

    const loop = detectLoop(path, config);
    expect(loop).not.toBeNull();
    expect(loop!.kind).toBe('return-to-start');
    expect(loop!.startIndex).toBe(0);
  });

  it('(a) refuses to close before MIN_WALK_DISTANCE_M is covered', () => {
    // A 20 m square: start and end coincide, but only ~80 m walked.
    const ring = densifyRing(squareRing(20), 5);
    expect(detectLoop([...ring, ring[0]!], config)).toBeNull();
  });

  it('(b) prefers self-intersection when both closures are available', () => {
    // Walk a square, then overshoot past the start so the last segment crosses
    // the first — both GR-02(a) and GR-02(b) hold.
    const path = [
      ...densifyRing(squareRing(250), 10),
      offsetMetres(ORIGIN, 0, 20),
      offsetMetres(ORIGIN, 20, -20),
    ];

    const loop = detectLoop(path, config);
    expect(loop!.kind).toBe('self-intersection');
  });

  it('(b) discards the tail before the intersection', () => {
    const path = approachThenLoopPath();

    const loop = detectLoop(path, config);
    expect(loop).not.toBeNull();
    expect(loop!.kind).toBe('self-intersection');

    // The ring starts partway along the approach, at the crossing — not at the
    // walker's front door (doc 06 §4.5).
    expect(loop!.startIndex).toBeGreaterThan(5);
    expect(loop!.ring.length).toBeLessThan(path.length);

    // Every ring vertex is east of where the walk began.
    const westernmost = Math.min(...loop!.ring.map(p => p.lng));
    expect(westernmost).toBeGreaterThan(path[0]!.lng);

    // Roughly the 200 m square plus the wedge back to the crossing point.
    expect(ringAreaM2(loop!.ring)).toBeGreaterThan(40_000);
    expect(ringAreaM2(loop!.ring)).toBeLessThan(60_000);
  });

  it('reports the whole walked path length, not the ring perimeter (GR-05 input)', () => {
    const loop = detectLoop(approachThenLoopPath(), config)!;

    // ~300 m of approach on top of the ~860 m loop. Using the ring perimeter
    // here instead would hand the walker a larger GR-05 allowance than they
    // earned.
    expect(loop.pathLengthM).toBeGreaterThan(1_000);
    expect(loop.pathLengthM).toBeGreaterThan(APPROACH_POINT_COUNT * 20);
  });

  it('resolves a figure-eight to a simple ring, never a crossed one', () => {
    const loop = detectLoop(figureEightPath(), config);

    expect(loop).not.toBeNull();
    expect(loop!.kind).toBe('self-intersection');
    expect(loop!.ring.length).toBeGreaterThanOrEqual(3);
    expect(ringAreaM2(loop!.ring)).toBeGreaterThan(0);

    // GR-03(3): the ring handed on for polygon construction must itself be
    // simple. A crossed ring is what produces an invalid polygon server-side.
    expect(findSelfIntersection(loop!.ring)).toBeNull();
  });
});
