import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { NOTIFICATION_EVENT_DEFS, getResolvedPreferencesForUser, type NotificationEventType } from '@/lib/notification-preferences';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isKnownEventType(v: string): v is NotificationEventType {
  return NOTIFICATION_EVENT_DEFS.some((d) => d.eventType === v);
}

export async function GET(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }

  const items = await getResolvedPreferencesForUser(userId);
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON', 400);

  const eventType = String(body.eventType || '').trim();
  if (!isKnownEventType(eventType)) return jsonError('Неизвестный eventType', 400);
  const eventDef = NOTIFICATION_EVENT_DEFS.find((d) => d.eventType === eventType);

  const data: { pushEnabled?: boolean; emailEnabled?: boolean } = {};
  if (body.pushEnabled !== undefined) data.pushEnabled = Boolean(body.pushEnabled);
  if (body.emailEnabled !== undefined) data.emailEnabled = Boolean(body.emailEnabled);

  if (!Object.keys(data).length) return jsonError('Нет полей для обновления', 400);

  await prisma.notificationPreference.upsert({
    where: { userId_eventType: { userId, eventType } },
    update: data,
    create: {
      userId,
      eventType,
      pushEnabled: data.pushEnabled ?? eventDef?.defaultPush ?? true,
      emailEnabled: data.emailEnabled ?? eventDef?.defaultEmail ?? false,
    },
  });

  const items = await getResolvedPreferencesForUser(userId);
  return NextResponse.json({ ok: true, items });
}
