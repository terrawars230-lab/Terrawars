import {useQuery} from '@tanstack/react-query';

import {queryKeys} from '@core/constants/queryKeys';
import {fetchLeaderboard} from '@features/leaderboard/api/leaderboardApi';
import {cachedGameConfig, fetchGameConfig} from '@features/settings/api/gameConfigApi';

/**
 * The map HUD's weekly goal (FR-61).
 *
 * Both halves come from the server and neither is invented on the device: the
 * progress is `weekly_scores.area_gained_m2` — the value the weekly board ranks
 * on, so the card and the board can never disagree — and the target is a
 * `game_config` tunable (CLAUDE.md rule 7).
 *
 * The score can be NEGATIVE, because being raided subtracts from it
 * (doc 03 §4). The card clamps rather than hiding: a bad week is exactly when a
 * player wants to see they are behind.
 */

export interface WeeklyContract {
  gainedM2: number;
  targetM2: number;
  /** Unclamped ratio; the card handles the 0–1 clamp for its own bar. */
  progress: number;
  isLoading: boolean;
}

export function useWeeklyContract(enabled: boolean): WeeklyContract {
  const {data: config} = useQuery({
    queryKey: queryKeys.gameConfig,
    queryFn: fetchGameConfig,
    staleTime: 5 * 60_000,
    initialData: cachedGameConfig,
  });

  const {data: weekly, isLoading} = useQuery({
    // limit 1: this only ever reads `me`, which the server populates whether or
    // not the player is on the returned page (FR-63). Asking for the full 50
    // rows to throw 49 away is a page of leaderboard on every map open.
    queryKey: queryKeys.leaderboards.weeklyMe(),
    queryFn: () => fetchLeaderboard('weekly', {limit: 1}),
    staleTime: 60_000,
    enabled,
  });

  const targetM2 = config?.weeklyContractTargetM2 ?? cachedGameConfig().weeklyContractTargetM2;
  const gainedM2 = weekly?.me?.valueM2 ?? 0;

  return {
    gainedM2,
    targetM2,
    progress: targetM2 > 0 ? gainedM2 / targetM2 : 0,
    isLoading,
  };
}
