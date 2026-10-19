import { NextResponse } from 'next/server';
import { requireUser, AuthError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        username: true,
        isAdmin: true,
        language: true,
        createdAt: true,
        updatedAt: true,
        gender: true,
        birthDate: true,
        // Данные тела — для расчёта калорий на устройстве без связи (кэш пользователя приложения).
        weightKg: true,
        heightCm: true,
        avatarPath: true,
        favoriteExercises: true,
        timeZone: true,
        dailyGoalPoints: true,
        dailyReminderTime: true,
      },
    });

    if (!u) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    // Exercises with an active training program: the dashboard shows the program
    // instead of «Рекомендация на сегодня» for them.
    const programs = await prisma.trainingProgram.findMany({
      where: { userId: user.id, isActive: true },
      select: { exerciseType: true },
    });
    const activeProgramExercises = Array.from(new Set(programs.map((p) => p.exerciseType)));

    return NextResponse.json({ ...u, activeProgramExercises });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
