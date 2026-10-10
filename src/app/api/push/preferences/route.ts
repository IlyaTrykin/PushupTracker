import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import {
  getDefaultFor,
  getResolvedPreferencesForUser,
  isNotificationEventType,
  isTelegramConfigured,
} from '@/lib/notification-preferences';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

/** `telegramAvailable`: the Telegram column is shown only when the bot is configured. */
function preferencesResponse(items: Awaited<ReturnType<typeof getResolvedPreferencesForUser>>, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ...extra, items, telegramAvailable: isTelegramConfigured() });
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
  return preferencesResponse(items);
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
  if (!isNotificationEventType(eventType)) return jsonError('Неизвестный eventType', 400);
  const eventDef = getDefaultFor(eventType);

  const data: { pushEnabled?: boolean; emailEnabled?: boolean; telegramEnabled?: boolean } = {};
  if (body.pushEnabled !== undefined) data.pushEnabled = Boolean(body.pushEnabled);
  if (body.emailEnabled !== undefined) data.emailEnabled = Boolean(body.emailEnabled);
  if (body.telegramEnabled !== undefined) data.telegramEnabled = Boolean(body.telegramEnabled);

  if (!Object.keys(data).length) return jsonError('Нет полей для обновления', 400);

  await prisma.notificationPreference.upsert({
    where: { userId_eventType: { userId, eventType } },
    update: data,
    create: {
      userId,
      eventType,
      pushEnabled: data.pushEnabled ?? eventDef.defaultPush,
      emailEnabled: data.emailEnabled ?? eventDef.defaultEmail,
      telegramEnabled: data.telegramEnabled ?? Boolean(eventDef.defaultTelegram),
    },
  });

  const items = await getResolvedPreferencesForUser(userId);
  return preferencesResponse(items, { ok: true });
}
