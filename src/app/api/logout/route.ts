import { NextResponse } from 'next/server';
import { clearSessionCookie, invalidateSession } from '@/lib/auth';

/**
 * Closes the session of this request only: the `Authorization: Bearer` one (native app) when present,
 * otherwise the cookie one — other sessions of the user stay alive (`getSessionToken` picks the token).
 */
export async function POST(request: Request) {
  try {
    await invalidateSession(request);
  } finally {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  }
}
