/**
 * Client-side fallback values for the server's `game_config` table.
 *
 * Rule 7 of CLAUDE.md: tunables live in `game_config` and are fetched at
 * startup (see `features/settings/api/gameConfigApi.ts`). These literals exist
 * for exactly two reasons:
 *
 *  1. the first cold start, before the config fetch resolves;
 *  2. a fully offline walk (FR-20 / NFR-08), where the client still has to draw
 *     an advisory preview.
 *
 * They are NEVER authoritative. The server re-derives every value from
 * `game_config` inside `finish_walk`, so a stale client can only ever be wrong
 * about a preview, never about ownership (doc 03 §1, D-05).
 */

export interface GameConfig {
  /** GR-02(a): how near the start you must return for the loop to count. */
  loopCloseRadiusM: number;
  /** GR-04: smallest claimable polygon. */
  minClaimAreaM2: number;
  /** GR-04: largest single claim. */
  maxClaimAreaM2: number;
  /** GR-04: minimum cleaned path length for any claim. */
  minWalkDistanceM: number;
  /** GR-04: minimum duration for any claim. */
  minWalkDurationS: number;
  /** GR-01(6): minimum accepted GPS samples. */
  minPoints: number;
  /** GR-01(1): points with worse horizontal accuracy are dropped. */
  maxAccuracyM: number;
  /** GR-04: sustained average speed ceiling. ~21.6 km/h. */
  maxSpeedMps: number;
  /** GR-01(5): single-segment ceiling; above this is a teleport. */
  maxBurstSpeedMps: number;
  /** GR-03(4): Douglas-Peucker tolerance before storage. */
  simplifyToleranceM: number;
  /** GR-05: slack on the max-area-per-perimeter check. */
  isoperimetricTolerance: number;
  /** GR-23: how long a fresh parcel cannot be stolen. */
  protectionHours: number;
  /** GR-20: remainders smaller than this are discarded as slivers. */
  minParcelAreaM2: number;
  /** GR-21: own parcels closer than this are merged. */
  mergeGapM: number;
  /**
   * FR-61: the weekly goal the map HUD shows progress against.
   *
   * Presentation, not a game rule — nothing rejects a claim for missing it. It
   * is here rather than a literal because the number is exactly the kind doc 07
   * expects to retune weekly once real walk distances are known (rule 7).
   */
  weeklyContractTargetM2: number;
}

export const DEFAULT_GAME_CONFIG: Readonly<GameConfig> = Object.freeze({
  loopCloseRadiusM: 30,
  minClaimAreaM2: 500,
  maxClaimAreaM2: 2_000_000,
  minWalkDistanceM: 200,
  minWalkDurationS: 120,
  minPoints: 20,
  maxAccuracyM: 30,
  maxSpeedMps: 6.0,
  maxBurstSpeedMps: 12.0,
  simplifyToleranceM: 3,
  isoperimetricTolerance: 1.15,
  protectionHours: 6,
  minParcelAreaM2: 100,
  mergeGapM: 2,
  weeklyContractTargetM2: 5_000,
});

/**
 * Client-only limits. These are UX guardrails, not game rules — the server
 * neither knows nor cares about them.
 */
export const WALK_LIMITS = Object.freeze({
  /** FR-12: distance filter for GPS sampling. */
  samplingDistanceFilterM: 5,
  /** FR-12: max interval between samples even when standing still. */
  samplingMaxIntervalMs: 5_000,
  /** FR-19: hard cap — a walk auto-ends past either bound. */
  maxDurationMs: 4 * 60 * 60 * 1000,
  maxDistanceM: 25_000,
  /** doc 05 §2: how often buffered points are flushed to the server. */
  pointUploadIntervalMs: 30_000,
  /** Max points held in a single upload batch. */
  pointUploadBatchSize: 200,
  /** FR-20: a queued claim older than this is dropped. */
  offlineQueueMaxAgeMs: 24 * 60 * 60 * 1000,
  /** doc 06 §4.5: trim the first/last N metres of a stored path (home-address risk). */
  pathPrivacyTrimM: 25,
});

/** Mapping from `game_config` row keys to the camelCase field they populate. */
export const GAME_CONFIG_KEY_MAP: Readonly<Record<string, keyof GameConfig>> = Object.freeze({
  LOOP_CLOSE_RADIUS_M: 'loopCloseRadiusM',
  MIN_CLAIM_AREA_M2: 'minClaimAreaM2',
  MAX_CLAIM_AREA_M2: 'maxClaimAreaM2',
  MIN_WALK_DISTANCE_M: 'minWalkDistanceM',
  MIN_WALK_DURATION_S: 'minWalkDurationS',
  MIN_POINTS: 'minPoints',
  MAX_ACCURACY_M: 'maxAccuracyM',
  MAX_SPEED_MPS: 'maxSpeedMps',
  MAX_BURST_SPEED_MPS: 'maxBurstSpeedMps',
  SIMPLIFY_TOLERANCE_M: 'simplifyToleranceM',
  ISOPERIMETRIC_TOLERANCE: 'isoperimetricTolerance',
  PROTECTION_HOURS: 'protectionHours',
  MIN_PARCEL_AREA_M2: 'minParcelAreaM2',
  MERGE_GAP_M: 'mergeGapM',
  WEEKLY_CONTRACT_TARGET_M2: 'weeklyContractTargetM2',
});
