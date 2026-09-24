/**
 * Client-side shape checks for the auth forms.
 *
 * Shared rather than copied per screen: three copies of an email regex drift
 * apart, and a user then gets "invalid email" on one screen for an address
 * another screen accepted.
 */

/** Supabase's own minimum is lower; 8 is ours, and the copy says so. */
export const MIN_PASSWORD_LENGTH = 8;

/** Length of the codes Supabase emails for sign-up and recovery. */
export const OTP_LENGTH = 6;

/**
 * Minimum age to create an account (doc 06 §4 rule 6). A location game with a
 * public map is not built for young children; the store content rating and
 * the target-audience declaration must match this.
 */
export const MIN_SIGNUP_AGE = 13;

/**
 * Shape check only.
 *
 * Deliberately permissive: the authoritative validation is the confirmation
 * email. A stricter regex rejects valid addresses (plus-addressing, new TLDs,
 * non-ASCII local parts) and the failure mode is a user who cannot sign up at
 * all — much worse than a typo caught one step later.
 */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Keeps only the digits of a pasted or autofilled code. iOS autofill pastes
 * the code with surrounding words, and a paste that silently fails validation
 * is worse than one that keeps the digits.
 */
export function sanitiseOtp(value: string): string {
  return value.replace(/\D/g, '').slice(0, OTP_LENGTH);
}
