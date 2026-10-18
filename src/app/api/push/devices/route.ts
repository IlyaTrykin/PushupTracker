import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requestLocale, requireUser } from '@/lib/auth';
import { registerPushDevice, removePushDevice, type PushDeviceResult } from '@/lib/push-devices';
import { hitRateLimit, tooManyRequests } from '@/lib/rate-limit';

/**
 * Native push devices of the iOS / Android apps (APNs / FCM tokens); rules in `src/lib/push-devices.ts`.
 * POST `{ platform, token }` — register (upsert by token, ≤ 10 active per user, ≤ 20 attempts an hour).
 * DELETE `{ token }` — remove the device with this token, whoever it is registered to.
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

function respond(result: PushDeviceResult, request: NextRequest): NextResponse {
  if (result.ok) return NextResponse.json({ ok: true });
  if (result.status === 429) return tooManyRequests(result.retryAfterSeconds, requestLocale(request));
  return jsonError(result.error, result.status);
}

export async function POST(request: NextRequest) {
  const userId = await currentUserId(request);
  if (typeof userId !== 'string') return userId;

  const body = await readJson(request);
  if (!body) return jsonError('Некорректный JSON', 400);
  try {
    return respond(await registerPushDevice(userId, body, { db: prisma, hitRateLimit }), request);
  } catch (e) {
    console.error('PUSH DEVICE REGISTER ERROR:', e instanceof Error ? e.message : e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function DELETE(request: NextRequest) {
  const userId = await currentUserId(request);
  if (typeof userId !== 'string') return userId;

  const body = await readJson(request);
  if (!body) return jsonError('Некорректный JSON', 400);
  try {
    return respond(await removePushDevice(body, prisma), request);
  } catch (e) {
    console.error('PUSH DEVICE DELETE ERROR:', e instanceof Error ? e.message : e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
