import { NextResponse } from 'next/server';
import { clearSessionCookie, getAuthUser, invalidateSession } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

/** `pushToken` from the body (the app sends its APNs / FCM token on sign-out); '' when absent. */
async function readPushToken(request: Request): Promise<string> {
  try {
    const text = await request.text();
    if (!text) return '';
    const body: unknown = JSON.parse(text);
    const token = body && typeof body === 'object' ? (body as { pushToken?: unknown }).pushToken : undefined;
    return typeof token === 'string' ? token.trim().slice(0, 4096) : '';
  } catch {
    return '';
  }
}

/**
 * Closes the session of this request only: the `Authorization: Bearer` one (native app) when present,
 * otherwise the cookie one — other sessions of the user stay alive (`getSessionToken` picks the token).
 * With `{ pushToken }` in the body the app's native push device of this user is removed too, so the
 * phone stops getting the signed-out user's notifications.
 */
export async function POST(request: Request) {
  try {
    const pushToken = await readPushToken(request);
    if (pushToken) {
      const user = await getAuthUser(request).catch(() => null);
      if (user) {
        // APNs tokens are stored lower-cased; FCM tokens as they are.
        const tokens = Array.from(new Set([pushToken, pushToken.toLowerCase()]));
        await prisma.pushDevice.deleteMany({ where: { userId: user.id, token: { in: tokens } } }).catch(() => {});
      }
    }
    await invalidateSession(request);
  } finally {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  }
}
