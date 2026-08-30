import type {GeoJsonLineString, GeoJsonPolygon, LatLng, Polygon, Ring} from '@core/types/geo';

/**
 * Conversions between the app's `{lat, lng}` shape and GeoJSON's `[lng, lat]`.
 *
 * This module is the ONLY place where the two orderings meet. Everything else
 * in the app works in `{lat, lng}`; everything on the wire is GeoJSON.
 */

export function toGeoJsonPosition({lat, lng}: LatLng): [number, number] {
  return [lng, lat];
}

export function fromGeoJsonPosition(position: readonly number[]): LatLng {
  const [lng, lat] = position;
  if (lng === undefined || lat === undefined) {
    throw new Error('Malformed GeoJSON position: expected [lng, lat]');
  }
  return {lat, lng};
}

/** Closes a ring by repeating the first vertex, as GeoJSON requires. */
function closeRing(ring: Ring): [number, number][] {
  if (ring.length === 0) {
    return [];
  }
  const positions = ring.map(toGeoJsonPosition);
  const first = positions[0]!;
  const last = positions[positions.length - 1]!;
  if (first[0] !== last[0] || first[1] !== last[1]) {
    positions.push(first);
  }
  return positions;
}

export function toGeoJsonPolygon(polygon: Polygon): GeoJsonPolygon {
  return {
    type: 'Polygon',
    coordinates: [closeRing(polygon.outer), ...(polygon.holes ?? []).map(closeRing)],
  };
}

export function toGeoJsonLineString(points: readonly LatLng[]): GeoJsonLineString {
  return {type: 'LineString', coordinates: points.map(toGeoJsonPosition)};
}

/**
 * Drops the repeated closing vertex, because app-side rings are open by
 * convention and react-native-maps draws a duplicate final vertex as a visible
 * seam.
 */
function openRing(positions: readonly (readonly number[])[]): Ring {
  const ring = positions.map(fromGeoJsonPosition);
  if (ring.length > 1) {
    const first = ring[0]!;
    const last = ring[ring.length - 1]!;
    if (first.lat === last.lat && first.lng === last.lng) {
      ring.pop();
    }
  }
  return ring;
}

export function fromGeoJsonPolygon(geometry: GeoJsonPolygon): Polygon {
  const [outer, ...holes] = geometry.coordinates;
  return {
    outer: outer ? openRing(outer) : [],
    holes: holes.length > 0 ? holes.map(openRing) : undefined,
  };
}

/** Splits a MultiPolygon into the flat list of polygons the map renders. */
export function fromGeoJsonMultiPolygon(
  coordinates: readonly (readonly number[])[][][],
): Polygon[] {
  return coordinates.map(rings => {
    const [outer, ...holes] = rings;
    return {
      outer: outer ? openRing(outer) : [],
      holes: holes.length > 0 ? holes.map(openRing) : undefined,
    };
  });
}
