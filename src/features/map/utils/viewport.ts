import type {MapBounds} from '@core/types/geo';

/**
 * Viewport maths for the map.
 *
 * Deliberately separate from `mapApi.ts`: these are pure functions with no
 * network, no Supabase client and no native dependency, so they can be tested
 * on their own. Keeping them in the API module would drag the whole auth stack
 * into a test about arithmetic.
 */

export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

/**
 * Converts a react-native-maps region to a bounding box.
 *
 * The deltas describe the FULL span, so half of each reaches an edge. Getting
 * this wrong produces a bbox twice the size of the viewport, which quietly
 * quadruples the rows every map pan asks the database for — exactly the kind of
 * thing that passes review and then shows up as an NFR-04 miss under load.
 */
export function regionToBounds(region: MapRegion): MapBounds {
  return {
    minLat: region.latitude - region.latitudeDelta / 2,
    maxLat: region.latitude + region.latitudeDelta / 2,
    minLng: region.longitude - region.longitudeDelta / 2,
    maxLng: region.longitude + region.longitudeDelta / 2,
  };
}

/**
 * Approximates a slippy-map zoom level from a longitude delta.
 *
 * react-native-maps reports a region, not a zoom, but the server's
 * simplification table (doc 04 §4) is keyed by zoom. 360° of longitude is zoom 0
 * and each level halves it, which is the standard relation.
 *
 * A non-positive delta returns the maximum zoom rather than `Infinity`: the map
 * briefly reports a zero span while initialising, and sending `Infinity` as the
 * zoom would fail the server's integer cast.
 */
export function regionToZoom(longitudeDelta: number, screenWidthRatio = 1): number {
  if (longitudeDelta <= 0) {
    return 20;
  }
  const zoom = Math.log2(360 / longitudeDelta) + Math.log2(screenWidthRatio);
  return Math.max(0, Math.min(20, Math.round(zoom)));
}
