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
 * With `{ pushToken }` in the body the phone stops getting push: the device of the signed-in user is
 * removed; a device the session cannot vouch for (the session already expired or was revoked, or the
 * token belongs to another account) is switched off (`isActive=false`) — never deleted, and switched
 * back on by its owner's next registration. Knowing the long secret token is required either way.
 */
export async function POST(request: Request) {
  try {
    const pushToken = await readPushToken(request);
    if (pushToken) {
      const user = await getAuthUser(request).catch(() => null);
      // APNs tokens are stored lower-cased; FCM tokens as they are.
      const tokens = Array.from(new Set([pushToken, pushToken.toLowerCase()]));
      if (user) await prisma.pushDevice.deleteMany({ where: { userId: user.id, token: { in: tokens } } }).catch(() => {});
      await prisma.pushDevice.updateMany({ where: { token: { in: tokens }, isActive: true }, data: { isActive: false } }).catch(() => {});
    }
    await invalidateSession(request);
  } finally {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  }
}
