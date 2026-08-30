import {toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';

/**
 * Leaderboards (doc 05 §4, FR-60/61/62).
 *
 * `me` is always populated, even when the user is outside the returned page
 * (FR-63). The server computes it, because a client that only has the top 50
 * cannot know it is rank 214.
 */

export type LeaderboardScope = 'global' | 'weekly' | 'local';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  colorHex: string;
  valueM2: number;
}

export interface Leaderboard {
  scope: LeaderboardScope;
  entries: LeaderboardEntry[];
  /** FR-63. Null when the user has never claimed anything. */
  me: {rank: number; valueM2: number} | null;
  period?: {isoYear: number; isoWeek: number};
}

export async function fetchLeaderboard(
  scope: LeaderboardScope,
  options: {limit?: number; offset?: number; city?: string} = {},
): Promise<Leaderboard> {
  const {limit = 50, offset = 0, city} = options;

  const {data, error} =
    scope === 'global'
      ? await supabase.rpc('leaderboard_global', {p_limit: limit, p_offset: offset})
      : scope === 'weekly'
      ? await supabase.rpc('leaderboard_weekly', {p_limit: limit, p_offset: offset})
      : await supabase.rpc('leaderboard_local', {p_city: city ?? '', p_limit: limit});

  if (error) {
    throw toApiError(error, 'Could not load the leaderboard');
  }

  const payload = (data ?? {}) as Record<string, unknown>;
  const entries = Array.isArray(payload.entries)
    ? (payload.entries as Record<string, unknown>[])
    : [];
  const me = payload.me as Record<string, unknown> | null;
  const period = payload.period as Record<string, unknown> | undefined;

  return {
    scope,
    entries: entries.map(entry => ({
      rank: Number(entry.rank ?? 0),
      userId: String(entry.user_id ?? ''),
      username: String(entry.username ?? ''),
      colorHex: String(entry.color_hex ?? '#9CA3AF'),
      valueM2: Number(entry.value_m2 ?? 0),
    })),
    me: me ? {rank: Number(me.rank ?? 0), valueM2: Number(me.value_m2 ?? 0)} : null,
    period: period
      ? {isoYear: Number(period.iso_year ?? 0), isoWeek: Number(period.iso_week ?? 0)}
      : undefined,
  };
}
