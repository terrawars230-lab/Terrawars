import {isClaimErrorCode, type ErrorCode} from '@core/constants/errorCodes';

/**
 * The single error type the repository layer throws.
 *
 * Screens never see a `PostgrestError`, a `FunctionsHttpError` or a raw
 * `TypeError` from fetch. Everything is normalised here so a component can ask
 * two questions and get a reliable answer: *is this the user's fault* and
 * *should I retry*.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number | null;
  readonly details: Record<string, unknown>;
  override readonly cause: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    options: {httpStatus?: number | null; details?: Record<string, unknown>; cause?: unknown} = {},
  ) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.httpStatus = options.httpStatus ?? null;
    this.details = options.details ?? {};
    this.cause = options.cause;
  }

  /**
   * doc 05 §7: a 422 claim rejection is a normal outcome, not a failure. The
   * user walked; they just did not earn land. Show the friendly copy and keep
   * the walk (doc 03 §6) — never a generic "something went wrong".
   */
  get isExpectedOutcome(): boolean {
    return isClaimErrorCode(this.code);
  }

  /**
   * Only transient transport failures are worth retrying. Retrying a 4xx just
   * burns battery and rate limit, and retrying a claim rejection would be a
   * correctness bug — `finish_walk` is idempotent, but the answer will not
   * change.
   */
  get isRetryable(): boolean {
    if (this.code === 'NETWORK_UNAVAILABLE' || this.code === 'TIMEOUT') {
      return true;
    }
    return this.httpStatus !== null && this.httpStatus >= 500;
  }

  /** True when the session is gone and the user must sign in again. */
  get requiresReauthentication(): boolean {
    return this.code === 'UNAUTHENTICATED' || this.httpStatus === 401;
  }

  static isApiError(error: unknown): error is ApiError {
    return error instanceof ApiError;
  }
}
