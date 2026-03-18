import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { isPushConfigured } from '@/lib/web-push';

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
  return NextResponse.json({ enabled: count > 0, count, configured: isPushConfigured() });
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

  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId,
      p256dh,
      auth,
      isActive: true,
      userAgent: request.headers.get('user-agent') || null,
    },
    create: {
      userId,
      endpoint,
      p256dh,
      auth,
      userAgent: request.headers.get('user-agent') || null,
      isActive: true,
    },
  });

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
