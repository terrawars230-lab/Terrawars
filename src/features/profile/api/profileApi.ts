import {parseErrorEnvelope, toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';

/**
 * Profile and stats repository (doc 05 §1, §5).
 *
 * `get_public_profile` returns public fields only — never walks, paths or
 * points (FR-05, doc 06 §4.1). That boundary lives in SQL rather than here, so
 * a careless `select('*')` in this file cannot widen it.
 */

export interface UserStats {
  totalAreaM2: number;
  areaDisplay: string;
  parcelsCount: number;
  totalDistanceM: number;
  walksCount: number;
  claimsCount: number;
  areaStolenM2: number;
  areaLostM2: number;
  stealsMade: number;
  bestClaimM2: number;
  rankGlobal: number;
}

export interface MyProfile {
  id: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  colorHex: string;
  homeCity: string | null;
  /** FR-02: true until the user has chosen a real username. */
  needsUsername: boolean;
  /**
   * FR-06: the account is inside its 7-day deletion grace period. The app
   * signs such a session out rather than letting it play on into a hard
   * delete. Absent (false) until the server migration that reports it runs.
   */
  deletionRequested: boolean;
  stats: UserStats;
}

export async function fetchMyProfile(): Promise<MyProfile> {
  const {data, error} = await supabase.rpc('get_me');
  if (error) {
    throw toApiError(error, 'Could not load your profile');
  }

  // get_me selects the caller's own row; a null means the session has no
  // profile behind it (deleted and purged). An empty profile would send that
  // user to the username gate for an account that no longer exists.
  if (!data) {
    throw toApiError(new Error('No profile for this session'), 'Could not load your profile');
  }

  const payload = data as Record<string, unknown>;
  return {
    id: String(payload.id ?? ''),
    username: String(payload.username ?? ''),
    displayName: payload.display_name ? String(payload.display_name) : null,
    avatarUrl: payload.avatar_url ? String(payload.avatar_url) : null,
    colorHex: String(payload.color_hex ?? '#3B82F6'),
    homeCity: payload.home_city ? String(payload.home_city) : null,
    needsUsername: Boolean(payload.needs_username),
    deletionRequested: Boolean(payload.deletion_requested),
    stats: parseStats(payload.stats),
  };
}

export interface PublicProfile {
  id: string;
  username: string;
  displayName: string | null;
  colorHex: string;
  homeCity: string | null;
  stats: UserStats;
}

export async function fetchPublicProfile(username: string): Promise<PublicProfile | null> {
  const {data, error} = await supabase.rpc('get_public_profile', {p_username: username});
  if (error) {
    throw toApiError(error, 'Could not load that player');
  }
  if (!data) {
    return null;
  }

  const payload = data as Record<string, unknown>;
  return {
    id: String(payload.id ?? ''),
    username: String(payload.username ?? ''),
    displayName: payload.display_name ? String(payload.display_name) : null,
    colorHex: String(payload.color_hex ?? '#9CA3AF'),
    homeCity: payload.home_city ? String(payload.home_city) : null,
    stats: parseStats(payload.stats),
  };
}

/** FR-03: colour change, at most once per 30 days. */
export async function updateMyColor(colorHex: string): Promise<void> {
  const {data, error} = await supabase.rpc('update_my_color', {p_color_hex: colorHex});
  if (error) {
    throw toApiError(error, 'Could not change your colour');
  }

  // COLOR_CHANGE_COOLDOWN and friends arrive as a doc 05 §7 envelope on a 200.
  // Parsed rather than wrapped in a plain Error, so the code survives and the
  // user sees "once every 30 days" instead of "something went wrong".
  const rejection = parseErrorEnvelope(data);
  if (rejection) {
    throw rejection;
  }
}

export interface StealEvent {
  id: string;
  areaM2: number;
  createdAt: string;
  counterpartUsername: string;
  counterpartColorHex: string;
}

/** FR-44: raid history, in both directions. */
export async function fetchStealEvents(direction: 'incoming' | 'outgoing'): Promise<StealEvent[]> {
  // The local session: getUser() is a network round trip, and RLS scopes the
  // rows to the caller server-side regardless.
  const userId = (await supabase.auth.getSession()).data.session?.user.id;
  if (!userId) {
    return [];
  }

  const selfColumn = direction === 'incoming' ? 'victim_id' : 'attacker_id';
  const otherColumn = direction === 'incoming' ? 'attacker_id' : 'victim_id';

  const {data, error} = await supabase
    .from('steal_events')
    .select(`id, area_m2, created_at, counterpart:profiles!${otherColumn}(username, color_hex)`)
    .eq(selfColumn, userId)
    .order('created_at', {ascending: false})
    .limit(50);

  if (error) {
    throw toApiError(error, 'Could not load your raid history');
  }

  return (data ?? []).map(row => {
    const counterpart = (row as Record<string, unknown>).counterpart as {
      username?: string;
      color_hex?: string;
    } | null;
    return {
      id: String(row.id),
      areaM2: Number(row.area_m2),
      createdAt: String(row.created_at),
      counterpartUsername: counterpart?.username ?? '[deleted]',
      counterpartColorHex: counterpart?.color_hex ?? '#9CA3AF',
    };
  });
}

function parseStats(raw: unknown): UserStats {
  const stats = (raw ?? {}) as Record<string, unknown>;
  return {
    totalAreaM2: Number(stats.total_area_m2 ?? 0),
    areaDisplay: String(stats.area_display ?? ''),
    parcelsCount: Number(stats.parcels_count ?? 0),
    totalDistanceM: Number(stats.total_distance_m ?? 0),
    walksCount: Number(stats.walks_count ?? 0),
    claimsCount: Number(stats.claims_count ?? 0),
    areaStolenM2: Number(stats.area_stolen_m2 ?? 0),
    areaLostM2: Number(stats.area_lost_m2 ?? 0),
    stealsMade: Number(stats.steals_made ?? 0),
    bestClaimM2: Number(stats.best_claim_m2 ?? 0),
    rankGlobal: Number(stats.rank_global ?? 0),
  };
}
