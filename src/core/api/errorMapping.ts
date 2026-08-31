import {AuthError, FunctionsHttpError, PostgrestError} from '@supabase/supabase-js';

import {API_ERROR_CODES, isClaimErrorCode, type ErrorCode} from '@core/constants/errorCodes';
import {createLogger} from '@core/logger/logger';

import {ApiError} from './ApiError';

/**
 * Normalises anything the network layer can throw into an `ApiError`.
 *
 * Supabase surfaces failures through at least four unrelated shapes
 * (`PostgrestError`, `AuthError`, `FunctionsHttpError`, and a bare `TypeError`
 * from fetch). Mapping them in one place is what lets every screen handle
 * errors with a single branch, and what stops a Postgres constraint name from
 * ever reaching a user.
 */

const logger = createLogger('api');

const apiErrorCodeSet: ReadonlySet<string> = new Set(API_ERROR_CODES);

/**
 * GoTrue error codes → our codes.
 *
 * Supabase Auth reports a stable machine `code` on every failure. Collapsing
 * them all into `ERR_VALIDATION` — which this used to do — turns "you have hit
 * the 2-emails-per-hour limit on the built-in mailer" into "Something in that
 * request didn't look right", and leaves the user with no idea what to do.
 * Every entry below has a specific, actionable message in `errors.*`.
 *
 * https://supabase.com/docs/guides/auth/debugging/error-codes
 */
const AUTH_CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  invalid_credentials: 'INVALID_CREDENTIALS',
  email_not_confirmed: 'EMAIL_NOT_CONFIRMED',
  user_already_exists: 'EMAIL_ALREADY_REGISTERED',
  email_exists: 'EMAIL_ALREADY_REGISTERED',
  weak_password: 'WEAK_PASSWORD',
  signup_disabled: 'SIGNUP_DISABLED',
  email_provider_disabled: 'SIGNUP_DISABLED',
  over_email_send_rate_limit: 'EMAIL_RATE_LIMITED',
  over_request_rate_limit: 'RATE_LIMITED',
  over_sms_send_rate_limit: 'RATE_LIMITED',
  validation_failed: 'ERR_VALIDATION',
  bad_json: 'ERR_VALIDATION',
  session_expired: 'UNAUTHENTICATED',
  refresh_token_not_found: 'UNAUTHENTICATED',
  no_authorization: 'UNAUTHENTICATED',
  user_banned: 'ACCOUNT_SUSPENDED',
};

function fromAuthError(error: AuthError): ApiError {
  // `code` is the stable machine identifier; `message` is prose that changes
  // between releases, so it is never matched on and never shown.
  const authCode = (error as AuthError & {code?: string}).code;
  const mapped = authCode ? AUTH_CODE_MAP[authCode] : undefined;

  const code: ErrorCode =
    mapped ??
    (error.status === 401
      ? 'UNAUTHENTICATED'
      : error.status === 429
      ? 'RATE_LIMITED'
      : error.status !== undefined && error.status >= 500
      ? 'INTERNAL'
      : 'ERR_VALIDATION');

  if (!mapped && authCode) {
    // An unmapped code still gets a sensible bucket from the status, but log it
    // so the map can grow rather than silently degrading to generic copy.
    logger.warn('Unmapped Supabase auth code', {authCode, status: error.status});
  }

  return new ApiError(code, error.message, {
    httpStatus: error.status ?? null,
    details: authCode ? {authCode} : {},
    cause: error,
  });
}

/** Postgres SQLSTATE codes we can translate into something meaningful. */
const PG_CODE_MAP: Readonly<Record<string, ErrorCode>> = {
  '23505': 'USERNAME_TAKEN', // unique_violation
  '23503': 'NOT_FOUND', // foreign_key_violation
  '23514': 'ERR_VALIDATION', // check_violation
  '42501': 'UNAUTHENTICATED', // insufficient_privilege — an RLS denial
  PGRST301: 'UNAUTHENTICATED', // PostgREST: JWT expired
  P0001: 'ERR_VALIDATION', // raise_exception from a PL/pgSQL function
};

export function toApiError(error: unknown, fallbackMessage = 'Request failed'): ApiError {
  if (ApiError.isApiError(error)) {
    return error;
  }

  if (error instanceof FunctionsHttpError) {
    return fromEdgeFunctionError(error);
  }

  if (error instanceof AuthError) {
    return fromAuthError(error);
  }

  if (isPostgrestError(error)) {
    const code = PG_CODE_MAP[error.code] ?? 'INTERNAL';
    // Postgres detail can name columns and constraints. Log it, never show it.
    logger.warn('Postgrest error', {pgCode: error.code, hint: error.hint});
    return new ApiError(code, error.message, {cause: error});
  }

  if (isAbortError(error)) {
    return new ApiError('TIMEOUT', 'The request took too long', {cause: error});
  }

  if (isNetworkError(error)) {
    return new ApiError('NETWORK_UNAVAILABLE', 'No connection', {cause: error});
  }

  return new ApiError('UNKNOWN', error instanceof Error ? error.message : fallbackMessage, {
    cause: error,
  });
}

/**
 * Unwraps the uniform error envelope from doc 05 §7:
 * `{ error: { code, message, details } }`.
 */
function fromEdgeFunctionError(error: FunctionsHttpError): ApiError {
  const status = error.context?.status ?? null;
  return new ApiError('INTERNAL', error.message, {httpStatus: status, cause: error});
}

/**
 * Reads a doc 05 §7 error envelope out of an RPC/function JSON body.
 *
 * `finish_walk` deliberately RETURNS a structured rejection rather than
 * raising (doc 04 §3), so the common rejection path arrives as a successful
 * HTTP response with an `error` field — not as a thrown error.
 */
export function parseErrorEnvelope(body: unknown): ApiError | null {
  if (!body || typeof body !== 'object') {
    return null;
  }

  const envelope = (body as {error?: unknown}).error;
  if (!envelope || typeof envelope !== 'object') {
    return null;
  }

  const {code, message, details} = envelope as {
    code?: unknown;
    message?: unknown;
    details?: unknown;
  };

  if (typeof code !== 'string') {
    return null;
  }

  return new ApiError(toKnownCode(code), typeof message === 'string' ? message : code, {
    details: (details as Record<string, unknown>) ?? {},
  });
}

function toKnownCode(code: string): ErrorCode {
  if (isClaimErrorCode(code) || apiErrorCodeSet.has(code)) {
    return code as ErrorCode;
  }
  logger.warn('Unrecognised error code from server', {code});
  return 'UNKNOWN';
}

function isPostgrestError(error: unknown): error is PostgrestError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'message' in error &&
    'details' in error
  );
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
}

function isNetworkError(error: unknown): boolean {
  return (
    error instanceof TypeError && /network request failed|failed to fetch/i.test(error.message)
  );
}
