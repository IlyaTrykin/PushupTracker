import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { HealthImportError, findImportedIds } from '@/lib/health-import';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/** Which Health keys (`hk:` / `hc:` ids) are already workouts of the user (≤ 500 asked). */
export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || !Array.isArray((body as { clientRequestIds?: unknown }).clientRequestIds)) {
      return NextResponse.json({ error: 'Некорректный JSON: нужен clientRequestIds' }, { status: 400 });
    }
    const imported = await findImportedIds(userId, (body as { clientRequestIds: string[] }).clientRequestIds, {
      findExistingRequestIds: async (id, ids) => {
        const rows = await prisma.workout.findMany({
          where: { userId: id, clientRequestId: { in: ids } },
          select: { clientRequestId: true },
        });
        return rows.map((row) => row.clientRequestId).filter((value): value is string => Boolean(value));
      },
    });
    return NextResponse.json({ imported });
  } catch (e) {
    if (e instanceof HealthImportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error('HEALTH IMPORTED POST ERROR:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
