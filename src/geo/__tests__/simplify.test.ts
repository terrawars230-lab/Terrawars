import {findSelfIntersection} from '@geo/loopDetection';
import {haversineDistanceM, ringAreaM2} from '@geo/measurement';
import {simplifyPath, simplifyRing} from '@geo/simplify';

import {ORIGIN, densifyRing, offsetMetres, squareRing} from './fixtures';

describe('simplifyPath — GR-03(4)', () => {
  it('leaves paths of two or fewer points alone', () => {
    const pair = [ORIGIN, offsetMetres(ORIGIN, 100, 0)];
    expect(simplifyPath(pair, 3)).toEqual(pair);
    expect(simplifyPath([], 3)).toEqual([]);
  });

  it('collapses a straight line to its endpoints', () => {
    const straight = Array.from({length: 50}, (_, i) => offsetMetres(ORIGIN, i * 10, 0));
    const simplified = simplifyPath(straight, 3);

    expect(simplified).toHaveLength(2);
    expect(simplified[0]).toEqual(straight[0]);
    expect(simplified[1]).toEqual(straight[straight.length - 1]);
  });

  it('is a no-op when the tolerance is zero or negative', () => {
    const path = densifyRing(squareRing(200), 8);
    expect(simplifyPath(path, 0)).toHaveLength(path.length);
    expect(simplifyPath(path, -5)).toHaveLength(path.length);
  });

  it('keeps every vertex within the tolerance of the original path', () => {
    // A noisy walk down a street: a straight line plus ±2 m of GPS wobble.
    const noisy = Array.from({length: 200}, (_, i) => offsetMetres(ORIGIN, i * 5, Math.sin(i) * 2));
    const simplified = simplifyPath(noisy, 3);

    expect(simplified.length).toBeLessThan(noisy.length);
    for (const point of simplified) {
      const nearest = Math.min(...noisy.map(p => haversineDistanceM(p, point)));
      expect(nearest).toBeLessThan(0.001);
    }
  });

  it('removes more vertices as the tolerance grows', () => {
    const noisy = Array.from({length: 300}, (_, i) =>
      offsetMetres(ORIGIN, i * 4, Math.sin(i / 3) * 6),
    );

    const tight = simplifyPath(noisy, 1).length;
    const loose = simplifyPath(noisy, 10).length;
    expect(loose).toBeLessThan(tight);
    expect(tight).toBeLessThan(noisy.length);
  });

  it('does not blow the stack on a long walk', () => {
    // 4 h at 5 m sampling — the FR-19 worst case, as a hard spiral so the
    // recursion cannot terminate early.
    const long = Array.from({length: 5000}, (_, i) =>
      offsetMetres(ORIGIN, Math.cos(i / 40) * i * 0.1, Math.sin(i / 40) * i * 0.1),
    );
    expect(() => simplifyPath(long, 3)).not.toThrow();
    expect(simplifyPath(long, 3).length).toBeLessThan(long.length);
  });
});

describe('simplifyRing', () => {
  it('leaves tiny rings alone', () => {
    const triangle = [ORIGIN, offsetMetres(ORIGIN, 50, 0), offsetMetres(ORIGIN, 0, 50)];
    expect(simplifyRing(triangle, 3)).toEqual(triangle);
  });

  it('reduces a densified square back towards its corners', () => {
    const dense = densifyRing(squareRing(250), 20);
    const simplified = simplifyRing(dense, 3);

    expect(dense).toHaveLength(80);
    expect(simplified.length).toBeLessThanOrEqual(8);
    expect(simplified.length).toBeGreaterThanOrEqual(4);
  });

  it('preserves area to within 1% at the launch tolerance', () => {
    const dense = densifyRing(squareRing(400), 25);
    const before = ringAreaM2(dense);
    const after = ringAreaM2(simplifyRing(dense, 3));

    expect(Math.abs(after - before) / before).toBeLessThan(0.01);
  });

  it('never returns a degenerate ring', () => {
    // A tolerance far larger than the shape would flatten it to a line.
    const dense = densifyRing(squareRing(50), 10);
    const simplified = simplifyRing(dense, 500);
    expect(simplified.length).toBeGreaterThanOrEqual(3);
    expect(ringAreaM2(simplified)).toBeGreaterThan(0);
  });

  it('does not introduce a self-intersection', () => {
    const wiggly = densifyRing(squareRing(300), 15).map((p, i) => ({
      lat: p.lat + Math.sin(i) * 0.00002,
      lng: p.lng + Math.cos(i) * 0.00002,
    }));

    const simplified = simplifyRing(wiggly, 3);
    expect(findSelfIntersection(simplified)).toBeNull();
  });

  it('does not leave a duplicated closing vertex', () => {
    const simplified = simplifyRing(densifyRing(squareRing(250), 20), 3);
    const first = simplified[0]!;
    const last = simplified[simplified.length - 1]!;
    expect(haversineDistanceM(first, last)).toBeGreaterThan(0.001);
  });
});

describe('perpendicular distance edge cases', () => {
  it('handles a zero-length segment (duplicate consecutive fixes)', () => {
    const path = [
      ORIGIN,
      offsetMetres(ORIGIN, 50, 0),
      offsetMetres(ORIGIN, 50, 0), // exact duplicate — a stationary GPS pair
      offsetMetres(ORIGIN, 50, 40),
      offsetMetres(ORIGIN, 100, 40),
    ];

    expect(() => simplifyPath(path, 3)).not.toThrow();
    const simplified = simplifyPath(path, 3);
    expect(simplified.length).toBeGreaterThanOrEqual(2);
    expect(simplified.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lng))).toBe(true);
  });

  it('measures to the nearer endpoint for a vertex beyond the segment', () => {
    // A hairpin: the middle vertex projects outside the start→end chord.
    const path = [ORIGIN, offsetMetres(ORIGIN, -80, 0), offsetMetres(ORIGIN, 10, 0)];
    // The spur is 80 m off the chord, far beyond a 3 m tolerance, so it stays.
    expect(simplifyPath(path, 3)).toHaveLength(3);
    // At a 200 m tolerance it collapses.
    expect(simplifyPath(path, 200)).toHaveLength(2);
  });
});
