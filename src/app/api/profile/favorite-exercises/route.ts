import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { FAVORITE_EXERCISE_LIMIT, isExerciseType, normalizeFavoriteExercises } from '@/lib/exercises';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function PUT(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => null);
    const raw: unknown = body?.favoriteExercises;
    if (!Array.isArray(raw)) return jsonError('favoriteExercises должен быть массивом');
    if (raw.some((item) => !isExerciseType(item))) return jsonError('Некорректный тип упражнения');

    const favoriteExercises = normalizeFavoriteExercises(raw);
    if (favoriteExercises.length !== new Set(raw).size) {
      return jsonError(`Можно выбрать не больше ${FAVORITE_EXERCISE_LIMIT} упражнений`);
    }

    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { favoriteExercises },
      select: { favoriteExercises: true },
    });

    return NextResponse.json({ favoriteExercises: updated.favoriteExercises });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
