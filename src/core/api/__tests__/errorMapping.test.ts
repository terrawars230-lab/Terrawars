import {AuthError} from '@supabase/supabase-js';

import {ApiError} from '@core/api/ApiError';
import {parseErrorEnvelope, toApiError} from '@core/api/errorMapping';
import en from '@core/i18n/locales/en.json';

/**
 * Auth failures are the first thing a new user can hit, and the only signal
 * they get is one line of copy. Mapping every GoTrue failure to
 * `ERR_VALIDATION` — which this used to do — rendered "Something in that
 * request didn't look right" for a rate limit, an already-registered email and
 * a wrong password alike, leaving the user with nothing to act on.
 *
 * These tests exist so that regression cannot come back quietly.
 */

/** Builds an AuthError the way supabase-js does, with a machine `code`. */
function authError(code: string, status: number, message = 'boom'): AuthError {
  const error = new AuthError(message, status, code);
  return error;
}

describe('toApiError — Supabase auth failures', () => {
  it.each([
    ['invalid_credentials', 400, 'INVALID_CREDENTIALS'],
    ['email_not_confirmed', 400, 'EMAIL_NOT_CONFIRMED'],
    ['user_already_exists', 422, 'EMAIL_ALREADY_REGISTERED'],
    ['email_exists', 422, 'EMAIL_ALREADY_REGISTERED'],
    ['weak_password', 422, 'WEAK_PASSWORD'],
    ['signup_disabled', 422, 'SIGNUP_DISABLED'],
    ['over_email_send_rate_limit', 429, 'EMAIL_RATE_LIMITED'],
    ['over_request_rate_limit', 429, 'RATE_LIMITED'],
    ['user_banned', 403, 'ACCOUNT_SUSPENDED'],
    ['session_expired', 401, 'UNAUTHENTICATED'],
  ])('maps %s to %s', (code, status, expected) => {
    expect(toApiError(authError(code, status)).code).toBe(expected);
  });

  it('keeps the machine code in details for diagnostics', () => {
    const mapped = toApiError(authError('over_email_send_rate_limit', 429));
    expect(mapped.details).toEqual({authCode: 'over_email_send_rate_limit'});
    expect(mapped.httpStatus).toBe(429);
  });

  it('falls back on HTTP status when the code is unrecognised', () => {
    expect(toApiError(authError('brand_new_code', 429)).code).toBe('RATE_LIMITED');
    expect(toApiError(authError('brand_new_code', 401)).code).toBe('UNAUTHENTICATED');
    expect(toApiError(authError('brand_new_code', 503)).code).toBe('INTERNAL');
    expect(toApiError(authError('brand_new_code', 400)).code).toBe('ERR_VALIDATION');
  });

  it('does not report a rate limit as the user getting the form wrong', () => {
    // The exact regression this file exists for.
    expect(toApiError(authError('over_email_send_rate_limit', 429)).code).not.toBe(
      'ERR_VALIDATION',
    );
  });

  it('marks a rate limit retryable and a bad password not', () => {
    expect(toApiError(authError('over_request_rate_limit', 429)).isRetryable).toBe(false);
    expect(toApiError(authError('invalid_credentials', 400)).isRetryable).toBe(false);
    expect(toApiError(authError('unexpected_failure', 500)).isRetryable).toBe(true);
  });

  it('flags session expiry as needing re-authentication', () => {
    expect(toApiError(authError('session_expired', 401)).requiresReauthentication).toBe(true);
  });
});

describe('toApiError — other transports', () => {
  it('passes an existing ApiError straight through', () => {
    const original = new ApiError('ERR_TOO_FAST', 'nope');
    expect(toApiError(original)).toBe(original);
  });

  it('maps a Postgres unique violation', () => {
    const pgError = {
      code: '23505',
      message: 'duplicate key',
      details: 'Key (username)=(sara) already exists.',
      hint: '',
      name: 'PostgrestError',
    };
    expect(toApiError(pgError).code).toBe('USERNAME_TAKEN');
  });

  it('maps an RLS denial to unauthenticated rather than an internal error', () => {
    const pgError = {
      code: '42501',
      message: 'permission denied',
      details: '',
      hint: '',
      name: 'PostgrestError',
    };
    expect(toApiError(pgError).code).toBe('UNAUTHENTICATED');
  });

  it('recognises a React Native fetch failure as offline', () => {
    const mapped = toApiError(new TypeError('Network request failed'));
    expect(mapped.code).toBe('NETWORK_UNAVAILABLE');
    expect(mapped.isRetryable).toBe(true);
  });

  it('recognises an aborted request as a timeout', () => {
    const aborted = new Error('aborted');
    aborted.name = 'AbortError';
    expect(toApiError(aborted).code).toBe('TIMEOUT');
  });

  it('falls back to UNKNOWN for anything unrecognised', () => {
    expect(toApiError({weird: true}).code).toBe('UNKNOWN');
  });
});

describe('parseErrorEnvelope — doc 05 §7', () => {
  it('reads a claim rejection out of a successful RPC body', () => {
    // finish_walk RETURNS a rejection rather than raising (doc 04 §3), so the
    // common rejection path arrives as HTTP 200 with an `error` field.
    const parsed = parseErrorEnvelope({
      error: {code: 'ERR_LOOP_NOT_CLOSED', message: 'not a loop', details: {}},
    });

    expect(parsed?.code).toBe('ERR_LOOP_NOT_CLOSED');
    expect(parsed?.isExpectedOutcome).toBe(true);
  });

  it('returns null for a body with no envelope', () => {
    expect(parseErrorEnvelope({status: 'accepted'})).toBeNull();
    expect(parseErrorEnvelope(null)).toBeNull();
    expect(parseErrorEnvelope('nope')).toBeNull();
  });

  it('downgrades an unrecognised code to UNKNOWN rather than trusting it', () => {
    expect(parseErrorEnvelope({error: {code: 'ERR_MADE_UP'}})?.code).toBe('UNKNOWN');
  });
});

describe('every mapped code has user-facing copy (NFR-11)', () => {
  // A code with no `errors.*` entry renders the raw key path to the user.
  it.each([
    'INVALID_CREDENTIALS',
    'EMAIL_NOT_CONFIRMED',
    'EMAIL_ALREADY_REGISTERED',
    'WEAK_PASSWORD',
    'SIGNUP_DISABLED',
    'EMAIL_RATE_LIMITED',
    'RATE_LIMITED',
    'UNAUTHENTICATED',
    'ACCOUNT_SUSPENDED',
    'INTERNAL',
    'ERR_VALIDATION',
    'NETWORK_UNAVAILABLE',
    'TIMEOUT',
    'UNKNOWN',
  ])('%s has a translation', code => {
    const messages = en.errors as Record<string, string | undefined>;
    expect(messages[code]).toBeTruthy();
  });
});
