/**
 * Every error code the server can return (doc 05 §7, doc 03 §6).
 *
 * The client rule from doc 05 §7: a 422 is a *normal outcome*, not a failure —
 * show the friendly copy and keep the saved walk. Only 5xx deserves a retry.
 */

/** Claim-rule rejections (HTTP 422). All are expected outcomes. */
export const CLAIM_ERROR_CODES = [
  'ERR_LOOP_NOT_CLOSED',
  'ERR_AREA_TOO_SMALL',
  'ERR_AREA_TOO_LARGE',
  'ERR_DISTANCE_TOO_SHORT',
  'ERR_DURATION_TOO_SHORT',
  'ERR_IMPOSSIBLE_AREA',
  'ERR_TOO_FAST',
  'ERR_TELEPORT',
  'ERR_TOO_FEW_POINTS',
  'ERR_INTEGRITY',
] as const;

export type ClaimErrorCode = (typeof CLAIM_ERROR_CODES)[number];

/** Transport / protocol level errors. */
export const API_ERROR_CODES = [
  'ERR_VALIDATION',
  'BBOX_TOO_LARGE',
  'UNAUTHENTICATED',
  'ACCOUNT_SUSPENDED',
  'NOT_FOUND',
  'ACTIVE_WALK_EXISTS',
  'USERNAME_TAKEN',
  'WALK_ALREADY_FINISHED',
  'COLOR_CHANGE_COOLDOWN',
  'RATE_LIMITED',
  'INTERNAL',
  'NETWORK_UNAVAILABLE',
  'TIMEOUT',
  'UNKNOWN',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export type ErrorCode = ClaimErrorCode | ApiErrorCode;

const claimErrorCodeSet: ReadonlySet<string> = new Set(CLAIM_ERROR_CODES);

export function isClaimErrorCode(code: string): code is ClaimErrorCode {
  return claimErrorCodeSet.has(code);
}

/**
 * i18n key for a code's user-facing message. Copy lives in
 * `core/i18n/locales/*.json` under `errors.*` — never inline in a component
 * (NFR-11).
 */
export function errorMessageKey(code: string): string {
  return `errors.${code}`;
}
