import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin as requireAdminUser, AuthError } from '@/lib/auth';
import { parseRewardMinPoints, serializeWorkoutReward } from '@/lib/workout-rewards';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

async function ensureAdmin(request: Request) {
  try {
    await requireAdminUser(request);
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new Error('ADMIN_CHECK_FAILED');
  }
}

export async function GET(request: Request) {
  try {
    await ensureAdmin(request);
  } catch (error) {
    if (error instanceof AuthError) return jsonError('Нет доступа', error.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const rewards = await prisma.workoutReward.findMany({
    orderBy: [{ minPointsTenths: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, message: true, minPointsTenths: true, createdAt: true, updatedAt: true },
  });

  return NextResponse.json({ rewards: rewards.map(serializeWorkoutReward) });
}

export async function POST(request: Request) {
  try {
    await ensureAdmin(request);
  } catch (error) {
    if (error instanceof AuthError) return jsonError('Нет доступа', error.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const message = String(body.message || '').trim();
  const minPoints = parseRewardMinPoints(body.minPoints);

  if (!message) return jsonError('message обязателен');
  if (!minPoints) return jsonError('minPoints должен быть числом >= 0');

  try {
    const reward = await prisma.workoutReward.create({
      data: {
        message,
        minPointsTenths: minPoints.minPointsTenths,
      },
      select: { id: true, message: true, minPointsTenths: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json({ reward: serializeWorkoutReward(reward) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonError('Поощрение с таким порогом баллов уже существует', 409);
    }
    return jsonError('Не удалось создать поощрение', 500);
  }
}

export async function PATCH(request: Request) {
  try {
    await ensureAdmin(request);
  } catch (error) {
    if (error instanceof AuthError) return jsonError('Нет доступа', error.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  const data: { message?: string; minPointsTenths?: number } = {};

  if (body.message !== undefined) {
    const message = String(body.message || '').trim();
    if (!message) return jsonError('message обязателен');
    data.message = message;
  }

  if (body.minPoints !== undefined) {
    const minPoints = parseRewardMinPoints(body.minPoints);
    if (!minPoints) return jsonError('minPoints должен быть числом >= 0');
    data.minPointsTenths = minPoints.minPointsTenths;
  }

  try {
    const reward = await prisma.workoutReward.update({
      where: { id },
      data,
      select: { id: true, message: true, minPointsTenths: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json({ reward: serializeWorkoutReward(reward) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return jsonError('Поощрение не найдено', 404);
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return jsonError('Поощрение с таким порогом баллов уже существует', 409);
    }
    return jsonError('Не удалось сохранить поощрение', 500);
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureAdmin(request);
  } catch (error) {
    if (error instanceof AuthError) return jsonError('Нет доступа', error.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  try {
    await prisma.workoutReward.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      return jsonError('Поощрение не найдено', 404);
    }
    return jsonError('Не удалось удалить поощрение', 500);
  }
}
