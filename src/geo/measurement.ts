import type {LatLng, Ring} from '@core/types/geo';

/**
 * Geodesic measurement primitives.
 *
 * Rule 9 of CLAUDE.md: areas are in metres, computed geodesically — never
 * stored or shown in degrees. These functions are the client-side, advisory
 * counterparts of PostGIS's `ST_Area(geom::geography)` and `ST_Distance`. They
 * exist for the live HUD (FR-14) and the "claim now" prompt (FR-18); the server
 * always recomputes with PostGIS before anything is written (D-05).
 */

/** WGS84 mean earth radius, metres. Matches the sphere PostGIS uses for `geography`. */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than Vincenty: at walking scale the ~0.3% ellipsoidal error
 * is far below GPS noise, and this runs on every sample on a mid-range phone.
 */
export function haversineDistanceM(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = lat2 - lat1;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);
  const h = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLng * sinHalfLng;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Total length of a path in metres. */
export function pathLengthM(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversineDistanceM(points[i - 1]!, points[i]!);
  }
  return total;
}

/** Perimeter of a closed ring (the closing segment is included). */
export function ringPerimeterM(ring: Ring): number {
  if (ring.length < 3) {
    return 0;
  }
  return pathLengthM(ring) + haversineDistanceM(ring[ring.length - 1]!, ring[0]!);
}

/**
 * Spherical excess area of a closed ring, in square metres.
 *
 * This is the same formula PostGIS uses for `ST_Area` on a `geography`, so a
 * client preview and the authoritative server number agree to within a few
 * parts per million — which matters, because a user who is shown "1 020 m²"
 * and then told their claim was rejected for being under 500 m² will file a
 * bug, and they will be right.
 *
 * The ring is treated as closed; do not repeat the first vertex.
 * Returns an unsigned area — winding order does not change the magnitude.
 */
export function ringAreaM2(ring: Ring): number {
  const n = ring.length;
  if (n < 3) {
    return 0;
  }

  let total = 0;
  for (let i = 0; i < n; i++) {
    const p1 = ring[i]!;
    const p2 = ring[(i + 1) % n]!;
    total +=
      (p2.lng - p1.lng) *
      DEG_TO_RAD *
      (2 + Math.sin(p1.lat * DEG_TO_RAD) + Math.sin(p2.lat * DEG_TO_RAD));
  }

  return Math.abs((total * EARTH_RADIUS_M * EARTH_RADIUS_M) / 2);
}

/** Initial bearing from `a` to `b`, degrees clockwise from north. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLng = (b.lng - a.lng) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);

  return (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360;
}

/** Arithmetic centroid of a ring's vertices. Good enough to centre a map on. */
export function ringCentroid(ring: Ring): LatLng {
  if (ring.length === 0) {
    throw new Error('Cannot compute the centroid of an empty ring');
  }
  let lat = 0;
  let lng = 0;
  for (const point of ring) {
    lat += point.lat;
    lng += point.lng;
  }
  return {lat: lat / ring.length, lng: lng / ring.length};
}

/**
 * Metres per degree of longitude at a given latitude.
 *
 * Needed whenever a metre-denominated tolerance has to be expressed in degrees
 * — simplification (GR-03) and the planar intersection test below.
 */
export function metresPerDegreeLng(latitude: number): number {
  return (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(latitude * DEG_TO_RAD);
}

/** Metres per degree of latitude. Effectively constant on a sphere. */
export function metresPerDegreeLat(): number {
  return (Math.PI / 180) * EARTH_RADIUS_M;
}

/**
 * Projects lat/lng onto a local metre-based plane centred on `origin`.
 *
 * An equirectangular projection is exact enough over the ~2 km span of a single
 * walk, and it lets the segment-intersection and simplification code work in
 * plain Cartesian metres instead of degrees — where a fixed tolerance would
 * silently mean different distances at different latitudes.
 */
export function toLocalPlane(point: LatLng, origin: LatLng): {x: number; y: number} {
  return {
    x: (point.lng - origin.lng) * metresPerDegreeLng(origin.lat),
    y: (point.lat - origin.lat) * metresPerDegreeLat(),
  };
}

export function fromLocalPlane(point: {x: number; y: number}, origin: LatLng): LatLng {
  return {
    lat: origin.lat + point.y / metresPerDegreeLat(),
    lng: origin.lng + point.x / metresPerDegreeLng(origin.lat),
  };
}
