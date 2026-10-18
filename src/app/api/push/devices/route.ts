import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { isUniqueViolation } from '@/lib/groups';
import { MAX_PUSH_DEVICES_PER_USER, isNativePlatform, normalizeDeviceToken } from '@/lib/native-push';
import { subscriptionsToEvict } from '@/lib/push-endpoint';

/**
 * Native push devices of the iOS / Android apps (APNs / FCM tokens).
 * POST `{ platform, token }` — upsert by token (a token re-registered by another account moves to it);
 * at most 10 active devices per user, the oldest are switched off.
 * DELETE `{ token }` — removes the device with this token, whoever it is registered to: the app of a
 * user who keeps push off releases a token left on the phone by the previous account (shared phone,
 * sign-out without connection). Knowing the token is the proof, as in POST, which can already move it.
 */

type JsonObject = Record<string, unknown>;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function readJson(request: NextRequest): Promise<JsonObject | null> {
  try {
    const text = await request.text();
    const parsed: unknown = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {
    return null;
  }
}

async function currentUserId(request: NextRequest): Promise<string | NextResponse> {
  try {
    return (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }
}

export async function POST(request: NextRequest) {
  const userId = await currentUserId(request);
  if (typeof userId !== 'string') return userId;

  const body = await readJson(request);
  if (!body) return jsonError('Некорректный JSON', 400);
  const platform = body.platform;
  if (!isNativePlatform(platform)) return jsonError('Некорректная платформа', 400);
  const token = normalizeDeviceToken(platform, body.token);
  if (!token) return jsonError('Некорректный токен устройства', 400);

  const data = { userId, platform, isActive: true };
  try {
    await prisma.pushDevice.upsert({ where: { token }, update: data, create: { ...data, token } });
  } catch (e) {
    // Two registrations of one device at once: the second one hits unique(token).
    if (!isUniqueViolation(e)) {
      console.error('PUSH DEVICE REGISTER ERROR:', e instanceof Error ? e.message : e);
      return jsonError('Внутренняя ошибка сервера', 500);
    }
    await prisma.pushDevice.updateMany({ where: { token }, data });
  }

  const active = await prisma.pushDevice.findMany({
    where: { userId, isActive: true },
    select: { id: true, updatedAt: true },
  });
  const evict = subscriptionsToEvict(active, MAX_PUSH_DEVICES_PER_USER);
  if (evict.length) await prisma.pushDevice.updateMany({ where: { id: { in: evict } }, data: { isActive: false } });

  return NextResponse.json({ ok: true });
}

/** The token as sent and as stored (APNs tokens are stored lower-cased; FCM tokens as they are). */
function deviceTokenVariants(token: string): string[] {
  return Array.from(new Set([token, token.toLowerCase()]));
}

export async function DELETE(request: NextRequest) {
  const userId = await currentUserId(request);
  if (typeof userId !== 'string') return userId;

  const body = await readJson(request);
  if (!body) return jsonError('Некорректный JSON', 400);
  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (!token) return jsonError('Не указан токен устройства', 400);

  // APNs tokens are stored lower-cased; FCM tokens as they are.
  await prisma.pushDevice.deleteMany({ where: { token: { in: deviceTokenVariants(token) } } });
  return NextResponse.json({ ok: true });
}
