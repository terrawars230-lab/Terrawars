import {parseErrorEnvelope, toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';
import type {GeoJsonPolygon, LatLng, MapBounds, Polygon} from '@core/types/geo';
import {fromGeoJsonPolygon} from '@geo/coordinates';

// Re-exported for convenience: the canonical home is utils/viewport, which has
// no network dependency and can therefore be unit-tested on its own.
export {regionToBounds, regionToZoom} from '../utils/viewport';

/**
 * Map repository (doc 05 §3, FR-51).
 *
 * Parcels are fetched by viewport and zoom, and the server decides how much
 * geometry to send (doc 04 §4). Below zoom 12 it returns aggregate counts
 * instead of polygons, which is why the result is a union — a caller that
 * assumes polygons at every zoom would render nothing over a whole country and
 * look broken.
 */

export interface ParcelFeature {
  id: string;
  polygon: Polygon;
  ownerId: string;
  ownerUsername: string;
  colorHex: string;
  areaM2: number;
  claimedAt: string;
  /** FR-41: null once the protection window has passed. */
  protectedUntil: string | null;
  isMine: boolean;
}

export interface ParcelCluster {
  centre: LatLng;
  parcelCount: number;
  totalAreaM2: number;
}

export type ParcelsResult =
  | {mode: 'geometry'; zoom: number; parcels: ParcelFeature[]; truncated: boolean}
  | {mode: 'aggregate'; zoom: number; clusters: ParcelCluster[]};

export async function fetchParcelsInBounds(
  bounds: MapBounds,
  zoom: number,
  limit = 2000,
): Promise<ParcelsResult> {
  const {data, error} = await supabase.rpc('parcels_in_bbox', {
    p_min_lng: bounds.minLng,
    p_min_lat: bounds.minLat,
    p_max_lng: bounds.maxLng,
    p_max_lat: bounds.maxLat,
    p_zoom: Math.round(zoom),
    p_limit: limit,
  });

  if (error) {
    throw toApiError(error, 'Could not load the map');
  }

  const envelopeError = parseErrorEnvelope(data);
  if (envelopeError) {
    throw envelopeError;
  }

  const payload = data as Record<string, unknown>;
  const features = Array.isArray(payload.features)
    ? (payload.features as Record<string, unknown>[])
    : [];

  if (payload.mode === 'aggregate') {
    return {
      mode: 'aggregate',
      zoom: Number(payload.zoom ?? zoom),
      clusters: features.map(toCluster).filter((c): c is ParcelCluster => c !== null),
    };
  }

  return {
    mode: 'geometry',
    zoom: Number(payload.zoom ?? zoom),
    parcels: features.map(toParcelFeature).filter((p): p is ParcelFeature => p !== null),
    truncated: Boolean(payload.truncated),
  };
}

/**
 * A feature whose geometry cannot be parsed is DROPPED, not thrown on.
 *
 * One malformed polygon must not blank the whole viewport — the user would see
 * an empty map with no explanation, which reads as "nobody owns anything here"
 * rather than "something went wrong".
 */
function toParcelFeature(raw: Record<string, unknown>): ParcelFeature | null {
  const geometry = raw.geometry as GeoJsonPolygon | undefined;
  const properties = (raw.properties ?? {}) as Record<string, unknown>;

  if (!geometry || geometry.type !== 'Polygon') {
    return null;
  }

  const polygon = fromGeoJsonPolygon(geometry);
  if (polygon.outer.length < 3) {
    return null;
  }

  return {
    id: String(raw.id ?? ''),
    polygon,
    ownerId: String(properties.owner_id ?? ''),
    ownerUsername: String(properties.owner_username ?? ''),
    colorHex: String(properties.color_hex ?? '#9CA3AF'),
    areaM2: Number(properties.area_m2 ?? 0),
    claimedAt: String(properties.claimed_at ?? ''),
    protectedUntil: properties.protected_until ? String(properties.protected_until) : null,
    isMine: Boolean(properties.is_mine),
  };
}

function toCluster(raw: Record<string, unknown>): ParcelCluster | null {
  const geometry = raw.geometry as {type?: string; coordinates?: number[]} | undefined;
  const properties = (raw.properties ?? {}) as Record<string, unknown>;

  const coordinates = geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return null;
  }

  const [lng, lat] = coordinates;
  if (typeof lng !== 'number' || typeof lat !== 'number') {
    return null;
  }

  return {
    centre: {lat, lng},
    parcelCount: Number(properties.parcel_count ?? 0),
    totalAreaM2: Number(properties.total_area_m2 ?? 0),
  };
}

/** FR-52: the parcel tap sheet. */
export async function fetchParcelDetail(parcelId: string): Promise<
  ParcelFeature & {
    areaDisplay: string;
    isProtected: boolean;
  }
> {
  const {data, error} = await supabase.rpc('parcel_detail', {p_parcel_id: parcelId});

  if (error) {
    throw toApiError(error, 'Could not load that parcel');
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const geometry = payload.geometry as GeoJsonPolygon | undefined;

  return {
    id: String(payload.id ?? parcelId),
    polygon: geometry ? fromGeoJsonPolygon(geometry) : {outer: []},
    ownerId: String(payload.owner_id ?? ''),
    ownerUsername: String(payload.owner_username ?? ''),
    colorHex: String(payload.color_hex ?? '#9CA3AF'),
    areaM2: Number(payload.area_m2 ?? 0),
    areaDisplay: String(payload.area_display ?? ''),
    claimedAt: String(payload.claimed_at ?? ''),
    protectedUntil: payload.protected_until ? String(payload.protected_until) : null,
    isProtected: Boolean(payload.is_protected),
    isMine: Boolean(payload.is_mine),
  };
}
