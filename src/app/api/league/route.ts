import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { DEFAULT_TIME_ZONE, dayKeyInZone, normalizeTimeZone } from '@/lib/calendar-day';
import { buildLeague, leagueWeekRange, loadLeagueEntries, parseLeagueWeek } from '@/lib/league';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/**
 * GET /api/league?week=current|previous — me and my accepted friends ranked by points of the
 * week (Monday–Sunday in my time zone). Soft-deleted friends are left out.
 */
export async function GET(request: NextRequest) {
  try {
    const actor = await requireUser(request);
    const week = parseLeagueWeek(request.nextUrl.searchParams.get('week'));

    const profile = await prisma.user.findUnique({ where: { id: actor.id }, select: { timeZone: true } });
    const today = dayKeyInZone(new Date(), normalizeTimeZone(profile?.timeZone ?? DEFAULT_TIME_ZONE));
    const range = leagueWeekRange(today, week);

    const entries = await loadLeagueEntries(actor.id, range.start);
    const league = buildLeague(entries, actor.id);
    const users = await prisma.user.findMany({
      where: { id: { in: entries.map((entry) => entry.userId) } },
      select: { id: true, username: true, avatarPath: true },
    });
    const byId = new Map(users.map((user) => [user.id, user]));

    return NextResponse.json({
      week,
      weekStart: range.start,
      weekEnd: range.end,
      rows: league.rows.map((row) => ({
        userId: row.userId,
        username: byId.get(row.userId)?.username ?? '',
        avatarPath: byId.get(row.userId)?.avatarPath ?? null,
        points: row.points,
        place: row.place,
        isMe: row.userId === actor.id,
      })),
      myPlace: league.myPlace,
      gapToNext: league.gapToNext,
      nextPlace: league.nextPlace,
    });
  } catch (error) {
    if (error instanceof AuthError) return jsonError('Не авторизован', error.status);
    console.error('GET /api/league ERROR:', error);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
