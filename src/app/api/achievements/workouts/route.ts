import { NextRequest, NextResponse } from 'next/server';
import { isBadgeCode, type WorkoutAchievementMarks } from '@/lib/achievements';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

const MAX_IDS = 200;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/** Owners whose workouts the user sees in feeds: self, accepted friends, active co-members of a group. */
async function visibleOwners(userId: string, ownerIds: string[]): Promise<Set<string>> {
  const visible = new Set<string>([userId]);
  const others = ownerIds.filter((id) => id !== userId);
  if (!others.length) return visible;

  const [links, memberships] = await Promise.all([
    prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [
          { userId, friendId: { in: others } },
          { friendId: userId, userId: { in: others } },
        ],
      },
      select: { userId: true, friendId: true },
    }),
    prisma.groupMembership.findMany({
      where: { userId, status: 'active', group: { deletedAt: null } },
      select: { groupId: true },
    }),
  ]);
  for (const link of links) visible.add(link.userId === userId ? link.friendId : link.userId);

  const groupIds = memberships.map((m) => m.groupId);
  if (groupIds.length) {
    const peers = await prisma.groupMembership.findMany({
      where: { groupId: { in: groupIds }, status: 'active', userId: { in: others }, group: { deletedAt: null } },
      select: { userId: true },
    });
    for (const peer of peers) visible.add(peer.userId);
  }
  return visible;
}

/** GET /api/achievements/workouts?ids=a,b — records and badges earned by these workouts (for the 🏆 mark in feeds). */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request);
    const raw = request.nextUrl.searchParams.get('ids') || '';
    const ids = Array.from(new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))).slice(0, MAX_IDS);
    if (!ids.length) return NextResponse.json({});

    const rows = await prisma.userAchievement.findMany({
      where: { workoutId: { in: ids } },
      select: { userId: true, kind: true, code: true, workoutId: true },
    });
    if (!rows.length) return NextResponse.json({});

    const visible = await visibleOwners(user.id, Array.from(new Set(rows.map((row) => row.userId))));
    const marks: WorkoutAchievementMarks = {};
    for (const row of rows) {
      if (!row.workoutId || !visible.has(row.userId)) continue;
      const mark = (marks[row.workoutId] ??= { records: [], badges: [] });
      if (row.kind === 'record' && (row.code === 'best_set' || row.code === 'best_day')) {
        if (!mark.records.includes(row.code)) mark.records.push(row.code);
      } else if (row.kind === 'badge' && isBadgeCode(row.code) && !mark.badges.includes(row.code)) {
        mark.badges.push(row.code);
      }
    }
    return NextResponse.json(marks);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('ACHIEVEMENT MARKS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
