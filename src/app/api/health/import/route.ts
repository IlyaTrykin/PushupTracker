import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { HealthImportError, importHealthWorkouts } from '@/lib/health-import';
import { createWorkoutForUser } from '@/lib/workout-create';

export const dynamic = 'force-dynamic';

/** Imports run / bike / row sessions read from Health by the app (≤ 50 per request). */
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !Array.isArray((body as { items?: unknown }).items)) {
      return NextResponse.json({ error: 'Некорректный JSON: нужен items' }, { status: 400 });
    }
    const owner = { id: user.id, username: user.username, timeZone: user.timeZone };
    const result = await importHealthWorkouts(owner, (body as { items: never[] }).items, { createWorkout: createWorkoutForUser });
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof HealthImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('HEALTH IMPORT POST ERROR:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
