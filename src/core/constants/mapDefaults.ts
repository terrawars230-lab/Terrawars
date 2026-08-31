/**
 * Camera defaults shared by every map surface.
 *
 * Here rather than per-screen because the world map and the walk map have to
 * agree: a user who taps "Start walk" should land at the zoom they were just
 * looking at the city with, not somewhere else.
 */

/** OQ-3's launch city. Used only until a real fix arrives. */
export const LAUNCH_CITY = {latitude: 31.5204, longitude: 74.3587} as const;

/**
 * Latitude/longitude span, in degrees, for each named zoom.
 *
 * `react-native-maps` has no zoom-level prop on a Region — the span IS the
 * zoom. Naming the two we use stops them being retyped as magic numbers, and
 * stops a map mounting at the library default, which is the whole globe.
 */
export const REGION_DELTA = {
  /** Roughly a city. The cold-start view before any fix. */
  city: 0.02,
  /** Roughly a few blocks. The right frame for watching a walk draw itself. */
  street: 0.004,
} as const;
