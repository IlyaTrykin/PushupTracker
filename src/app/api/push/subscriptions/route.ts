import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { isPushConfigured } from '@/lib/web-push';
import { isNativePlatform, isNativePushConfigured } from '@/lib/native-push';
import { isUniqueViolation } from '@/lib/groups';
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  isAllowedPushEndpoint,
  isValidPushKey,
  subscriptionsToEvict,
} from '@/lib/push-endpoint';

type JsonObject = Record<string, unknown>;
type PushSubscriptionBody = JsonObject & {
  endpoint?: unknown;
  keys?: {
    p256dh?: unknown;
    auth?: unknown;
  };
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function readBodySafe(text: string): JsonObject {
  try {
    const parsed = text ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as JsonObject;
  } catch {
    throw new Error('BAD_JSON');
  }
}

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }

  const count = await prisma.pushSubscription.count({ where: { userId, isActive: true } });
  // Native app: are APNs / FCM keys set on the server (for `?platform=ios|android` — that platform's).
  const platform = request.nextUrl.searchParams.get('platform');
  const nativeConfigured = isNativePushConfigured(isNativePlatform(platform) ? platform : undefined);
  return NextResponse.json({ enabled: count > 0, count, configured: isPushConfigured(), nativeConfigured });
}

export async function POST(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }

  const text = await request.text();
  let body: PushSubscriptionBody;
  try {
    body = readBodySafe(text);
  } catch {
    return jsonError('Некорректный JSON', 400);
  }

  const endpoint = String(body.endpoint || '').trim();
  const p256dh = String(body.keys?.p256dh || '').trim();
  const auth = String(body.keys?.auth || '').trim();

  if (!endpoint || !p256dh || !auth) return jsonError('Некорректная push-подписка', 400);
  // Только https на хосты push-сервисов браузеров (S09): иначе сервер стучался бы куда скажут.
  if (!isAllowedPushEndpoint(endpoint)) return jsonError('Адрес push-подписки не поддерживается', 400);
  if (!isValidPushKey(p256dh) || !isValidPushKey(auth)) return jsonError('Некорректная push-подписка', 400);

  const userAgent = (request.headers.get('user-agent') || '').slice(0, 512) || null;
  const data = { userId, p256dh, auth, userAgent, isActive: true };

  try {
    await prisma.pushSubscription.upsert({
      where: { endpoint },
      update: data,
      create: { ...data, endpoint },
    });
  } catch (e) {
    // Две одновременные регистрации одного устройства: вторая упирается в unique(endpoint).
    if (!isUniqueViolation(e)) {
      console.error('PUSH SUBSCRIBE ERROR:', e);
      return jsonError('Внутренняя ошибка сервера', 500);
    }
    await prisma.pushSubscription.updateMany({ where: { endpoint }, data });
  }

  // Не больше 10 устройств на пользователя: самые давние вытесняются.
  const subs = await prisma.pushSubscription.findMany({
    where: { userId },
    select: { id: true, updatedAt: true },
  });
  const evict = subscriptionsToEvict(subs, MAX_PUSH_SUBSCRIPTIONS_PER_USER);
  if (evict.length) await prisma.pushSubscription.deleteMany({ where: { id: { in: evict } } });

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }

  const text = await request.text();
  let body: PushSubscriptionBody;
  try {
    body = readBodySafe(text);
  } catch {
    return jsonError('Некорректный JSON', 400);
  }

  const endpoint = String(body.endpoint || '').trim();

  if (endpoint) {
    await prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
  } else {
    await prisma.pushSubscription.deleteMany({ where: { userId } });
  }

  return NextResponse.json({ ok: true });
}
