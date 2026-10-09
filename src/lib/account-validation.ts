/**
 * Validation of new account data (registration, profile changes).
 * Existing usernames are never re-validated: they stay as they are.
 */

const EMAIL_MAX_LENGTH = 254;
const ATOM = '[^\\s@"<>()\\[\\],;:\\\\.]+';
// local@domain.tld: no spaces, quotes, angle brackets or display names; local part ≤ 64.
const EMAIL_RE = new RegExp(`^(?=[^@]{1,64}@)${ATOM}(?:\\.${ATOM})*@(?:${ATOM}\\.)+${ATOM}$`);

const USERNAME_RE = /^[a-zA-Z0-9._-]{3,32}$/;

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** `trim().toLowerCase()` of a well-formed address of ≤254 chars, else null. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > EMAIL_MAX_LENGTH) return null;
  return EMAIL_RE.test(email) ? email : null;
}

export function validateNewUsername(raw: unknown): { ok: true; value: string } | { ok: false; code: string } {
  if (typeof raw !== 'string' || !raw.trim()) return { ok: false, code: 'USERNAME_REQUIRED' };
  const value = raw.trim();
  if (value.length < 3 || value.length > 32) return { ok: false, code: 'USERNAME_LENGTH' };
  if (!USERNAME_RE.test(value)) return { ok: false, code: 'USERNAME_CHARS' };
  return { ok: true, value };
}

export function validateNewPassword(raw: unknown): { ok: true } | { ok: false; code: string } {
  if (typeof raw !== 'string' || raw.length === 0) return { ok: false, code: 'PASSWORD_REQUIRED' };
  const length = Array.from(raw).length;
  if (length < PASSWORD_MIN_LENGTH) return { ok: false, code: 'PASSWORD_TOO_SHORT' };
  if (length > PASSWORD_MAX_LENGTH) return { ok: false, code: 'PASSWORD_TOO_LONG' };
  return { ok: true };
}
