'use client';

/** Where a visitor came from, kept in the browser until signup (30 days). */
const KEY = 'pt_attribution';
const TTL_MS = 30 * 86_400_000;
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

type Stored = { invite?: string; ref?: string; utm?: Record<string, string>; ts: number };

function read(): Stored | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return v && typeof v.ts === 'number' && Date.now() - v.ts < TTL_MS ? v : null;
  } catch {
    return null;
  }
}

/** Remembers invite / ref / utm from the current URL (and an explicit invite code); newer values win. */
export function captureAttribution(inviteCode?: string): void {
  try {
    const params = new URLSearchParams(window.location.search);
    const prev = read() ?? { ts: Date.now() };
    const next: Stored = { ...prev, ts: Date.now() };
    const invite = inviteCode || params.get('invite');
    if (invite) next.invite = invite;
    const ref = params.get('ref');
    if (ref) next.ref = ref;
    const utm: Record<string, string> = {};
    for (const k of UTM) {
      const v = params.get(k);
      if (v) utm[k] = v;
    }
    if (Object.keys(utm).length) next.utm = utm;
    if (next.invite || next.ref || next.utm) window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage blocked — attribution is best effort
  }
}

/** Payload for POST /api/register `attribution` (server validates and drops junk). */
export function readAttribution(): { invite?: string; ref?: string; utm?: Record<string, string> } | null {
  const v = read();
  if (!v) return null;
  return { invite: v.invite, ref: v.ref, utm: v.utm };
}

export function clearAttribution(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
