/**
 * Geometry primitives shared by the map, the walk recorder and the geometry
 * engine.
 *
 * Coordinate convention: everything in this app is WGS84 / EPSG:4326.
 * We store `{lat, lng}` objects in app code because that is what
 * react-native-maps and the location APIs speak, and convert to GeoJSON's
 * `[lng, lat]` ordering only at the network boundary (see `toGeoJsonPolygon`).
 * Mixing the two orderings is the single most common bug in geo code — the
 * conversion lives in exactly one place for that reason.
 */

export interface LatLng {
  lat: number;
  lng: number;
}

/** A raw GPS sample as it comes off the device. */
export interface GpsSample extends LatLng {
  /** Monotonic sequence within its walk. Server dedupes on (walk_id, seq). */
  seq: number;
  /** Epoch milliseconds. */
  timestamp: number;
  /** Horizontal accuracy in metres. `null` when the platform did not report it. */
  accuracyM: number | null;
  /** Instantaneous speed reported by the platform, m/s. */
  speedMps: number | null;
  altitudeM: number | null;
  headingDeg: number | null;
  /**
   * doc 06 §2 — set when the platform flags the fix as coming from a mock
   * provider. Collected, uploaded, and judged server-side. Never trusted, and
   * never used to reject a walk on the device.
   */
  isMock: boolean;
}

/** Outer ring of a polygon, first point NOT repeated. Closure is implied. */
export type Ring = LatLng[];

export interface Polygon {
  /** Outer boundary. */
  outer: Ring;
  /** GR-22: enclaves. Present on parcels received from the server. */
  holes?: Ring[];
}

export interface MapBounds {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export interface MapRegion extends LatLng {
  latitudeDelta: number;
  longitudeDelta: number;
}

/** GeoJSON wire types — used only at the network boundary. */
export type GeoJsonPosition = [longitude: number, latitude: number];

export interface GeoJsonPolygon {
  type: 'Polygon';
  /** `[outerRing, ...holes]`, each ring closed (first point repeated last). */
  coordinates: GeoJsonPosition[][];
}

export interface GeoJsonMultiPolygon {
  type: 'MultiPolygon';
  coordinates: GeoJsonPosition[][][];
}

export interface GeoJsonLineString {
  type: 'LineString';
  coordinates: GeoJsonPosition[];
}

export interface GeoJsonPoint {
  type: 'Point';
  coordinates: GeoJsonPosition;
}

export type GeoJsonGeometry =
  | GeoJsonPolygon
  | GeoJsonMultiPolygon
  | GeoJsonLineString
  | GeoJsonPoint;
