import { NextResponse } from 'next/server';
import { requireUser, AuthError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { normalizeTimeZone } from '@/lib/calendar-day';
import { programSessionsToday } from '@/lib/program-plan';

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

    // Exercises with an active training program: the dashboard hides «Рекомендация на сегодня» for
    // them and links to today's open session, if there is one (sessions within ±36 h cover any zone).
    const now = new Date();
    const programs = await prisma.trainingProgram.findMany({
      where: { userId: user.id, isActive: true },
      select: {
        exerciseType: true,
        sessions: {
          where: {
            completed: false,
            scheduledAt: { gte: new Date(now.getTime() - 36 * 3600_000), lte: new Date(now.getTime() + 36 * 3600_000) },
          },
          select: { id: true, scheduledAt: true, completed: true },
        },
      },
    });
    const activeProgramExercises = Array.from(new Set(programs.map((p) => p.exerciseType)));
    const programSessionToday = programSessionsToday(programs, { now, timeZone: normalizeTimeZone(u.timeZone) });

    return NextResponse.json({ ...u, activeProgramExercises, programSessionToday });
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
