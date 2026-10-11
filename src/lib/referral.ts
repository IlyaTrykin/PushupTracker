import { randomBytes } from 'node:crypto';

/** Unambiguous alphabet: no 0/o, 1/l/i. */
const INVITE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_RE = new RegExp(`^[${INVITE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`);

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;
export type UtmKey = (typeof UTM_KEYS)[number];
export type Utm = Partial<Record<UtmKey, string>>;

export type SignupAttribution = {
  inviteCode: string | null;
  ref: string | null;
  utm: Utm | null;
};

export function generateInviteCode(random: (n: number) => Buffer = randomBytes): string {
  const bytes = random(INVITE_CODE_LENGTH);
  let out = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) out += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  return out;
}

export function normalizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim().toLowerCase();
  return INVITE_CODE_RE.test(code) ? code : null;
}

const TAG_RE = /^[\p{L}\p{N}._~-]{1,64}$/u;

function cleanTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim().toLowerCase().slice(0, 64);
  return TAG_RE.test(value) ? value : null;
}

/** Validates attribution sent by the client at signup; anything malformed is dropped, never rejected. */
export function parseSignupAttribution(raw: unknown): SignupAttribution {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const utmRaw = obj.utm && typeof obj.utm === 'object' ? (obj.utm as Record<string, unknown>) : {};
  const utm: Utm = {};
  for (const key of UTM_KEYS) {
    const v = cleanTag(utmRaw[key]);
    if (v) utm[key] = v;
  }
  return {
    inviteCode: normalizeInviteCode(obj.invite),
    ref: cleanTag(obj.ref),
    utm: Object.keys(utm).length ? utm : null,
  };
}

/** One short label for reports: invite beats utm beats ref. */
export function signupSourceLabel(a: SignupAttribution, inviteAccepted: boolean): string {
  if (inviteAccepted) return 'invite';
  if (a.utm?.utm_source) return `utm:${a.utm.utm_source}`;
  if (a.ref) return `ref:${a.ref}`;
  return 'direct';
}
