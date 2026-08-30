import type {GpsSample, LatLng} from '@core/types/geo';

/**
 * Shared geometry fixtures, including the pathological ones CLAUDE.md rule 4
 * requires: self-intersecting, figure-eight, sliver, enclave.
 *
 * All fixtures are anchored near Lahore (31.52 N) — the launch city per OQ-3 —
 * so the latitude-dependent metre/degree conversions are exercised at a
 * realistic value rather than at the equator where they are degenerate.
 */

export const ORIGIN: LatLng = {lat: 31.5204, lng: 74.3587};

/** Metres per degree at the fixture latitude, for building exact-size shapes. */
const M_PER_DEG_LAT = 111_195;
const M_PER_DEG_LNG = 94_800; // ≈ cos(31.52°) × M_PER_DEG_LAT

export function offsetMetres(origin: LatLng, eastM: number, northM: number): LatLng {
  return {
    lat: origin.lat + northM / M_PER_DEG_LAT,
    lng: origin.lng + eastM / M_PER_DEG_LNG,
  };
}

/** An axis-aligned square of the given side length, walked counter-clockwise. */
export function squareRing(sideM: number, origin: LatLng = ORIGIN): LatLng[] {
  return [
    offsetMetres(origin, 0, 0),
    offsetMetres(origin, sideM, 0),
    offsetMetres(origin, sideM, sideM),
    offsetMetres(origin, 0, sideM),
  ];
}

/** Densifies a ring so it looks like a walk rather than four corner fixes. */
export function densifyRing(ring: LatLng[], pointsPerEdge: number): LatLng[] {
  const result: LatLng[] = [];
  for (let i = 0; i < ring.length; i++) {
    const from = ring[i]!;
    const to = ring[(i + 1) % ring.length]!;
    for (let step = 0; step < pointsPerEdge; step++) {
      const t = step / pointsPerEdge;
      result.push({
        lat: from.lat + (to.lat - from.lat) * t,
        lng: from.lng + (to.lng - from.lng) * t,
      });
    }
  }
  return result;
}

export interface SampleOptions {
  /** Seconds between consecutive samples. */
  intervalS?: number;
  startedAtMs?: number;
  accuracyM?: number;
  isMock?: boolean;
}

/** Turns a bare path into a plausible GPS sample stream. */
export function toSamples(path: readonly LatLng[], options: SampleOptions = {}): GpsSample[] {
  const {intervalS = 5, startedAtMs = 1_772_000_000_000, accuracyM = 8, isMock = false} = options;

  return path.map((point, index) => ({
    ...point,
    seq: index,
    timestamp: startedAtMs + index * intervalS * 1000,
    accuracyM,
    speedMps: 1.4,
    altitudeM: 217,
    headingDeg: null,
    isMock,
  }));
}

/**
 * A clean claimable loop: a ~250 m square walked in ~14 minutes.
 * Area ≈ 62 500 m², path ≈ 1 000 m. Comfortably inside every GR-04 bound.
 */
export function validLoopSamples(): GpsSample[] {
  const path = densifyRing(squareRing(250), 12);
  return toSamples([...path, path[0]!], {intervalS: 7});
}

/**
 * Figure-eight: two lobes joined by a crossing.
 *
 * The crossing is deliberately transversal — the return leg cuts through the
 * MIDDLE of an earlier segment, not through one of its vertices. A path that
 * crosses exactly at a shared vertex is not a real GPS trace, and GR-02(b)
 * treats it as jitter rather than a lap (see `segmentIntersection`).
 *
 * The lobes are unequal in size so a test can tell which one survived.
 */
export function figureEightPath(): LatLng[] {
  return [
    offsetMetres(ORIGIN, 0, 0),
    offsetMetres(ORIGIN, 150, 0),
    offsetMetres(ORIGIN, 150, 150),
    offsetMetres(ORIGIN, 0, 150),
    // Comes back just above the start, then cuts down across the first edge.
    offsetMetres(ORIGIN, 0, 10),
    offsetMetres(ORIGIN, 150, -100),
    offsetMetres(ORIGIN, 10, -100),
    offsetMetres(ORIGIN, 10, -20),
    offsetMetres(ORIGIN, 140, 20),
  ];
}

/**
 * A long approach walk followed by a loop — the doc 06 §4.5 walk-from-home
 * shape. GR-02(b) must discard the approach tail rather than claiming it.
 */
export function approachThenLoopPath(): LatLng[] {
  const approach = Array.from({length: 15}, (_, i) => offsetMetres(ORIGIN, -300 + i * 20, 0));
  const loop = [
    offsetMetres(ORIGIN, 0, 0),
    offsetMetres(ORIGIN, 200, 0),
    offsetMetres(ORIGIN, 200, 200),
    offsetMetres(ORIGIN, 0, 200),
    // Overshoots past the approach line, crossing it mid-segment near x = -83.
    offsetMetres(ORIGIN, -100, -40),
    offsetMetres(ORIGIN, 30, -60),
  ];
  return [...approach, ...loop];
}

/** How many leading points of `approachThenLoopPath` are pure approach. */
export const APPROACH_POINT_COUNT = 15;

/** A path that never comes back: GR-02 must report no loop. */
export function openPath(): LatLng[] {
  return Array.from({length: 60}, (_, i) => offsetMetres(ORIGIN, i * 20, 0));
}

/** A loop far too small to claim — ~10 m square, ~100 m² (GR-04 min is 500). */
export function tinyLoopPath(): LatLng[] {
  return densifyRing(squareRing(10), 6);
}

/**
 * A long, thin loop: enough distance and points to reach the area check, but
 * only ~440 m² enclosed. A walker circling a narrow strip of park produces
 * exactly this. Isolates `ERR_AREA_TOO_SMALL` from the checks ahead of it.
 */
export function thinLoopPath(): LatLng[] {
  const rectangle = [
    offsetMetres(ORIGIN, 0, 0),
    offsetMetres(ORIGIN, 110, 0),
    offsetMetres(ORIGIN, 110, 4),
    offsetMetres(ORIGIN, 0, 4),
  ];
  return densifyRing(rectangle, 18);
}

/**
 * doc 03 §5 example E: a fabricated claim — a huge polygon submitted with a
 * short path.
 *
 * Note this can only ever arrive as a forged API payload, never from
 * `buildClaimPreview`: for any genuinely walked closed path the walked length
 * is at least the ring perimeter, so GR-05 holds by construction. The client
 * check is a cheap consistency guard; the fabrication case is the server's
 * (doc 06 §3).
 */
export function impossibleAreaSamples(): GpsSample[] {
  const ring = densifyRing(squareRing(1000), 6);
  return toSamples([...ring, ring[0]!], {intervalS: 60});
}

/**
 * A route covered at vehicle speed: ~8.3 m/s average.
 *
 * Deliberately below MAX_BURST_SPEED_MPS (12) on every single segment, so the
 * teleport rule in GR-01(5) does not fire first and the walk is rejected by
 * GR-04's average-speed check as intended.
 */
export function tooFastSamples(): GpsSample[] {
  const path = densifyRing(squareRing(300), 12);
  return toSamples([...path, path[0]!], {intervalS: 3});
}
