import {toApiError} from '@core/api/errorMapping';
import {supabase} from '@core/api/supabase/client';
import {
  DEFAULT_GAME_CONFIG,
  GAME_CONFIG_KEY_MAP,
  type GameConfig,
} from '@core/constants/gameConfig';
import {createLogger} from '@core/logger/logger';
import {storage} from '@core/storage/storage';
import {StorageKeys} from '@core/storage/storageKeys';

/**
 * Fetches the server's tunables (CLAUDE.md rule 7).
 *
 * These change without a release, and doc 07 expects them to be retuned weekly
 * after launch. The client caches the last successful fetch so a cold start
 * with no network still has real values for its advisory preview — the alternative
 * is a first walk that previews against launch defaults the server abandoned
 * months ago.
 */

const logger = createLogger('game-config');

export async function fetchGameConfig(): Promise<GameConfig> {
  const {data, error} = await supabase.from('game_config').select('key, value');

  if (error) {
    // Cached values beat defaults, and defaults beat failing. None of the three
    // is authoritative: the server re-derives every value inside finish_walk.
    const cached = storage.getObject<GameConfig>(StorageKeys.gameConfig);
    if (cached) {
      logger.warn('Using the cached game config; the fetch failed');
      return cached;
    }
    throw toApiError(error, 'Could not load game settings');
  }

  const config: GameConfig = {...DEFAULT_GAME_CONFIG};

  for (const row of data ?? []) {
    const field = GAME_CONFIG_KEY_MAP[row.key];
    // Server-only keys (MAX_CLAIMS_PER_DAY) have no client field. Ignore rather
    // than warn — the client is not supposed to know about all of them.
    if (!field) {
      continue;
    }

    const parsed = Number(row.value);
    if (Number.isFinite(parsed)) {
      config[field] = parsed;
    } else {
      logger.warn('Ignoring a non-numeric game_config value', {key: row.key});
    }
  }

  storage.setObject(StorageKeys.gameConfig, config);
  return config;
}

/** The cached config, for a synchronous read before the fetch resolves. */
export function cachedGameConfig(): GameConfig {
  return storage.getObject<GameConfig>(StorageKeys.gameConfig) ?? DEFAULT_GAME_CONFIG;
}
