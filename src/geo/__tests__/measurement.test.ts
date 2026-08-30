import {
  bearingDeg,
  haversineDistanceM,
  metresPerDegreeLng,
  pathLengthM,
  ringAreaM2,
  ringCentroid,
  ringPerimeterM,
  toLocalPlane,
  fromLocalPlane,
} from '@geo/measurement';

import {ORIGIN, offsetMetres, squareRing} from './fixtures';

describe('haversineDistanceM', () => {
  it('is zero for identical points', () => {
    expect(haversineDistanceM(ORIGIN, ORIGIN)).toBe(0);
  });

  it('measures a known east-west offset within 0.5%', () => {
    const east = offsetMetres(ORIGIN, 1000, 0);
    expect(haversineDistanceM(ORIGIN, east)).toBeCloseTo(1000, -1);
  });

  it('measures a known north-south offset within 0.5%', () => {
    const north = offsetMetres(ORIGIN, 0, 1000);
    expect(haversineDistanceM(ORIGIN, north)).toBeCloseTo(1000, -1);
  });

  it('is symmetric', () => {
    const other = offsetMetres(ORIGIN, 400, 900);
    expect(haversineDistanceM(ORIGIN, other)).toBeCloseTo(haversineDistanceM(other, ORIGIN), 9);
  });

  it('handles the antimeridian without returning a near-global distance', () => {
    const west = {lat: 0, lng: 179.999};
    const east = {lat: 0, lng: -179.999};
    expect(haversineDistanceM(west, east)).toBeLessThan(500);
  });
});

describe('ringAreaM2', () => {
  it('returns 0 for degenerate rings', () => {
    expect(ringAreaM2([])).toBe(0);
    expect(ringAreaM2([ORIGIN])).toBe(0);
    expect(ringAreaM2([ORIGIN, offsetMetres(ORIGIN, 10, 0)])).toBe(0);
  });

  it('matches the analytic area of a 250 m square within 1%', () => {
    const area = ringAreaM2(squareRing(250));
    expect(area).toBeGreaterThan(250 * 250 * 0.99);
    expect(area).toBeLessThan(250 * 250 * 1.01);
  });

  it('is unsigned — winding order does not change the magnitude', () => {
    const ring = squareRing(300);
    expect(ringAreaM2([...ring].reverse())).toBeCloseTo(ringAreaM2(ring), 6);
  });

  it('scales quadratically with side length', () => {
    const small = ringAreaM2(squareRing(100));
    const large = ringAreaM2(squareRing(200));
    expect(large / small).toBeCloseTo(4, 1);
  });

  it('never returns an area in degrees (CLAUDE.md rule 9)', () => {
    // A degree-space shoelace on this fixture would be ~1e-5. Metres are ~6e4.
    expect(ringAreaM2(squareRing(250))).toBeGreaterThan(1000);
  });
});

describe('ringPerimeterM', () => {
  it('includes the closing segment', () => {
    const ring = squareRing(100);
    expect(ringPerimeterM(ring)).toBeCloseTo(400, -1);
    // pathLengthM leaves the ring open, so it is one side short.
    expect(pathLengthM(ring)).toBeCloseTo(300, -1);
  });

  it('returns 0 for rings with fewer than three vertices', () => {
    expect(ringPerimeterM([ORIGIN, offsetMetres(ORIGIN, 5, 5)])).toBe(0);
  });
});

describe('bearingDeg', () => {
  it.each([
    ['north', 0, 100, 0],
    ['east', 100, 0, 90],
    ['south', 0, -100, 180],
    ['west', -100, 0, 270],
  ])('points %s', (_label, eastM, northM, expected) => {
    const target = offsetMetres(ORIGIN, eastM, northM);
    expect(bearingDeg(ORIGIN, target)).toBeCloseTo(expected, 0);
  });
});

describe('ringCentroid', () => {
  it('finds the middle of a square', () => {
    const centroid = ringCentroid(squareRing(200));
    const expected = offsetMetres(ORIGIN, 100, 100);
    expect(haversineDistanceM(centroid, expected)).toBeLessThan(1);
  });

  it('throws on an empty ring rather than returning NaN', () => {
    expect(() => ringCentroid([])).toThrow(/empty ring/i);
  });
});

describe('local plane projection', () => {
  it('round-trips a point to within a millimetre', () => {
    const point = offsetMetres(ORIGIN, 850, -1200);
    const roundTripped = fromLocalPlane(toLocalPlane(point, ORIGIN), ORIGIN);
    expect(haversineDistanceM(point, roundTripped)).toBeLessThan(0.001);
  });

  it('places the origin at (0, 0)', () => {
    expect(toLocalPlane(ORIGIN, ORIGIN)).toEqual({x: 0, y: 0});
  });

  it('shrinks a degree of longitude as latitude rises', () => {
    expect(metresPerDegreeLng(0)).toBeGreaterThan(metresPerDegreeLng(60));
    expect(metresPerDegreeLng(60)).toBeCloseTo(metresPerDegreeLng(0) / 2, -2);
  });
});
