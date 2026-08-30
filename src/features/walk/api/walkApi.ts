import {ApiError} from '@core/api/ApiError';
import {parseErrorEnvelope, toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';
import type {ClaimErrorCode} from '@core/constants/errorCodes';
import {createLogger} from '@core/logger/logger';
import type {GeoJsonPolygon, GpsSample} from '@core/types/geo';

/**
 * Walk repository (doc 05 §2).
 *
 * The contract that matters: the client uploads points and asks the server to
 * finish the walk. It never computes a result and never writes a parcel
 * (CLAUDE.md rule 1). Everything returned here is the server's verdict.
 */

const logger = createLogger('walk-api');

export interface StartWalkResult {
  walkId: string;
  /** True when an existing active walk was resumed rather than started (FR-15). */
  resumed: boolean;
}

/**
 * Starts a walk, or resumes the one already open.
 *
 * `client_walk_id` makes this idempotent (NFR-06): a retry over a flaky link
 * returns the same walk instead of tripping the one-active-walk-per-user index
 * and stranding the user with a 409 they cannot clear.
 */
export async function startWalk(clientWalkId: string): Promise<StartWalkResult> {
  const userId = (await supabase.auth.getUser()).data.user?.id;
  if (!userId) {
    throw new ApiError('UNAUTHENTICATED', 'Sign in to start a walk');
  }

  const existing = await getActiveWalk();
  if (existing) {
    logger.info('Resuming an active walk');
    return {walkId: existing.id, resumed: true};
  }

  const {data, error} = await supabase
    .from('walks')
    .insert({
      user_id: userId,
      client_walk_id: clientWalkId,
      started_at: new Date().toISOString(),
      device_meta: deviceMeta(),
    })
    .select('id')
    .single();

  if (error) {
    throw toApiError(error, 'Could not start the walk');
  }
  return {walkId: data.id, resumed: false};
}

export interface ActiveWalk {
  id: string;
  startedAt: string;
}

export async function getActiveWalk(): Promise<ActiveWalk | null> {
  const {data, error} = await supabase
    .from('walks')
    .select('id, started_at')
    .eq('status', 'active')
    .maybeSingle();

  if (error) {
    throw toApiError(error, 'Could not check for an active walk');
  }
  return data ? {id: data.id, startedAt: data.started_at} : null;
}

/**
 * Uploads a batch of points (doc 05 §2).
 *
 * `upsert` on the (walk_id, seq) primary key makes a re-sent batch a no-op,
 * which is not an edge case: a walk runs for 45 minutes on mobile data and
 * batches WILL be retried. Losing points to a duplicate-key error would put a
 * hole in the middle of someone's loop.
 */
export async function uploadPoints(walkId: string, points: readonly GpsSample[]): Promise<number> {
  if (points.length === 0) {
    return 0;
  }

  const rows = points.map(point => ({
    walk_id: walkId,
    seq: point.seq,
    ts: new Date(point.timestamp).toISOString(),
    lat: point.lat,
    lng: point.lng,
    accuracy_m: point.accuracyM,
    speed_mps: point.speedMps,
    altitude_m: point.altitudeM,
    heading: point.headingDeg,
    is_mock: point.isMock,
  }));

  const {error} = await supabase
    .from('walk_points')
    .upsert(rows, {onConflict: 'walk_id,seq', ignoreDuplicates: true});

  if (error) {
    throw toApiError(error, 'Could not upload your route');
  }
  return rows.length;
}

// ── Finishing a walk ────────────────────────────────────────────────────────

export interface WalkSummary {
  id: string;
  distanceM: number;
  durationS: number;
  avgSpeedMps: number;
  pointCount: number;
}

export interface StealSummary {
  victimUsername: string;
  colorHex: string;
  areaM2: number;
}

export interface BlockedSummary {
  ownerUsername: string;
  areaM2: number;
  protectedUntil: string;
}

export interface AcceptedClaim {
  status: 'accepted';
  claimId: string;
  walk: WalkSummary;
  rawAreaM2: number;
  netAreaGainM2: number;
  stolenAreaM2: number;
  geometry: GeoJsonPolygon | null;
  steals: StealSummary[];
  blocked: BlockedSummary[];
  stats: {totalAreaM2: number; parcelsCount: number; rankGlobal: number} | null;
}

export interface RejectedClaim {
  status: 'rejected';
  claimId: string | null;
  errorCode: ClaimErrorCode | string;
  walk: WalkSummary;
}

export type FinishWalkResult = AcceptedClaim | RejectedClaim;

/**
 * Finishes a walk and resolves the claim.
 *
 * A rejection is NOT an exception. doc 05 §7 is explicit that a 422 is a
 * normal, expected outcome, and doc 03 §6 requires the walk to be saved
 * regardless — so this returns a discriminated union and only throws for
 * transport or auth failures. Modelling a rejection as a thrown error would
 * push every caller into a catch block that has to re-derive whether the user
 * did anything wrong.
 */
export async function finishWalk(
  walkId: string,
  idempotencyKey: string,
  attemptClaim = true,
): Promise<FinishWalkResult> {
  const {data, error} = await supabase.rpc('finish_walk', {
    p_walk_id: walkId,
    p_idempotency_key: idempotencyKey,
    p_ended_at: new Date().toISOString(),
    p_attempt_claim: attemptClaim,
  });

  if (error) {
    throw toApiError(error, 'Could not finish the walk');
  }

  const envelopeError = parseErrorEnvelope(data);
  if (envelopeError) {
    throw envelopeError;
  }

  return parseFinishResult(data);
}

/** Maps the snake_case JSON envelope from doc 05 §2 onto camelCase types. */
function parseFinishResult(raw: unknown): FinishWalkResult {
  const payload = raw as Record<string, unknown>;
  const walk = parseWalkSummary(payload.walk);

  if (payload.status === 'accepted') {
    const claim = (payload.claim ?? {}) as Record<string, unknown>;
    const stats = payload.stats as Record<string, unknown> | null;

    return {
      status: 'accepted',
      claimId: String(payload.claim_id ?? ''),
      walk,
      rawAreaM2: Number(claim.raw_area_m2 ?? 0),
      netAreaGainM2: Number(claim.net_area_gain_m2 ?? 0),
      stolenAreaM2: Number(claim.stolen_area_m2 ?? 0),
      geometry: (claim.geometry as GeoJsonPolygon | undefined) ?? null,
      steals: asArray(payload.steals).map(entry => ({
        victimUsername: String(entry.victim_username ?? ''),
        colorHex: String(entry.color_hex ?? '#9CA3AF'),
        areaM2: Number(entry.area_m2 ?? 0),
      })),
      blocked: asArray(payload.blocked).map(entry => ({
        ownerUsername: String(entry.owner_username ?? ''),
        areaM2: Number(entry.area_m2 ?? 0),
        protectedUntil: String(entry.protected_until ?? ''),
      })),
      stats: stats
        ? {
            totalAreaM2: Number(stats.total_area_m2 ?? 0),
            parcelsCount: Number(stats.parcels_count ?? 0),
            rankGlobal: Number(stats.rank_global ?? 0),
          }
        : null,
    };
  }

  return {
    status: 'rejected',
    claimId: payload.claim_id ? String(payload.claim_id) : null,
    errorCode: String(payload.error_code ?? 'UNKNOWN'),
    walk,
  };
}

function parseWalkSummary(raw: unknown): WalkSummary {
  const walk = (raw ?? {}) as Record<string, unknown>;
  return {
    id: String(walk.id ?? ''),
    distanceM: Number(walk.distance_m ?? 0),
    durationS: Number(walk.duration_s ?? 0),
    avgSpeedMps: Number(walk.avg_speed_mps ?? 0),
    pointCount: Number(walk.point_count ?? 0),
  };
}

function asArray(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
}

/** FR-17: discards an interrupted walk without attempting a claim. */
export async function abandonWalk(walkId: string): Promise<void> {
  const {error} = await supabase
    .from('walks')
    .update({status: 'abandoned', ended_at: new Date().toISOString()})
    .eq('id', walkId);

  if (error) {
    throw toApiError(error, 'Could not discard the walk');
  }
}

/**
 * Device facts sent with every walk (doc 06 §2).
 *
 * Diagnostic and anti-cheat context only — never an identifier we could track
 * a person by across accounts.
 */
function deviceMeta(): Record<string, string> {
  const {Platform} = require('react-native') as typeof import('react-native');
  return {
    platform: Platform.OS,
    os_version: String(Platform.Version),
  };
}
