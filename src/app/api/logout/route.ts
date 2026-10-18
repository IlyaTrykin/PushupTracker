import { NextResponse } from 'next/server';
import { clearSessionCookie, getAuthUser, invalidateSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { releasePushTokenOnLogout } from '@/lib/push-devices';

/** `pushToken` from the body (the app sends its APNs / FCM token on sign-out); '' when absent. */
async function readPushToken(request: Request): Promise<string> {
  try {
    const text = await request.text();
    if (!text) return '';
    const body: unknown = JSON.parse(text);
    const token = body && typeof body === 'object' ? (body as { pushToken?: unknown }).pushToken : undefined;
    return typeof token === 'string' ? token : '';
  } catch {
    return '';
  }
}

/**
 * Closes the session of this request only: the `Authorization: Bearer` one (native app) when present,
 * otherwise the cookie one — other sessions of the user stay alive (`getSessionToken` picks the token).
 * With `{ pushToken }` in the body the phone stops getting push (`releasePushTokenOnLogout`: the
 * signed-in user's device is removed, one the session cannot vouch for is only switched off).
 */
export async function POST(request: Request) {
  try {
    const pushToken = await readPushToken(request);
    if (pushToken.trim()) {
      const user = await getAuthUser(request).catch(() => null);
      await releasePushTokenOnLogout(pushToken, user?.id ?? null, prisma);
    }
    await invalidateSession(request);
  } finally {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  }
}
