import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { sendWebPushToUsers } from '@/lib/web-push';

const ALLOWED_EMOJI = ['👍', '🔥', '👎', '💩'] as const;
const ALLOWED_EMOJI_SET = new Set<string>(ALLOWED_EMOJI);

type ReactionPayload = {
  summary: Array<{ emoji: string; count: number }>;
  myEmoji: string | null;
  recent: Array<{
    id: string;
    userId: string;
    username: string;
    avatarPath: string | null;
    emoji: string;
    createdAt: string;
  }>;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function parseWorkoutIds(request: NextRequest): string[] {
  const raw = request.nextUrl.searchParams.get('ids') || '';
  return Array.from(new Set(raw.split(',').map((x) => x.trim()).filter(Boolean))).slice(0, 120);
}

function emptyPayload(): ReactionPayload {
  return { summary: [], myEmoji: null, recent: [] };
}

async function getAccessibleWorkoutIds(userId: string, requestedWorkoutIds: string[]): Promise<string[]> {
  if (!requestedWorkoutIds.length) return [];

  const workouts = await prisma.workout.findMany({
    where: { id: { in: requestedWorkoutIds } },
    select: { id: true, userId: true },
  });

  if (!workouts.length) return [];

  const ownerIds = Array.from(new Set(workouts.map((w) => w.userId).filter((id) => id !== userId)));
  const accessibleOwners = new Set<string>([userId]);

  if (ownerIds.length) {
    const links = await prisma.friendship.findMany({
      where: {
        status: 'accepted',
        OR: [
          { userId, friendId: { in: ownerIds } },
          { friendId: userId, userId: { in: ownerIds } },
        ],
      },
      select: { userId: true, friendId: true },
    });

    for (const f of links) {
      accessibleOwners.add(f.userId === userId ? f.friendId : f.userId);
    }
  }

  return workouts.filter((w) => accessibleOwners.has(w.userId)).map((w) => w.id);
}

async function buildReactionMap(userId: string, requestedWorkoutIds: string[]): Promise<Record<string, ReactionPayload>> {
  const accessibleWorkoutIds = await getAccessibleWorkoutIds(userId, requestedWorkoutIds);
  if (!accessibleWorkoutIds.length) return {};

  const reactions = await prisma.workoutReaction.findMany({
    where: { workoutId: { in: accessibleWorkoutIds } },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      workoutId: true,
      userId: true,
      emoji: true,
      updatedAt: true,
      user: { select: { username: true, avatarPath: true } },
    },
  });

  const base = new Map<
    string,
    {
      counts: Map<string, number>;
      myEmoji: string | null;
      recent: ReactionPayload['recent'];
    }
  >();

  for (const workoutId of accessibleWorkoutIds) {
    base.set(workoutId, { counts: new Map<string, number>(), myEmoji: null, recent: [] });
  }

  for (const r of reactions) {
    const row = base.get(r.workoutId);
    if (!row) continue;

    row.counts.set(r.emoji, (row.counts.get(r.emoji) ?? 0) + 1);
    if (r.userId === userId) row.myEmoji = r.emoji;

    row.recent.push({
      id: r.id,
      userId: r.userId,
      username: r.user.username,
      avatarPath: r.user.avatarPath ?? null,
      emoji: r.emoji,
      createdAt: r.updatedAt.toISOString(),
    });
  }

  const out: Record<string, ReactionPayload> = {};
  for (const [workoutId, row] of base.entries()) {
    const summary = Array.from(row.counts.entries())
      .map(([emoji, count]) => ({ emoji, count }))
      .sort((a, b) => (b.count - a.count) || a.emoji.localeCompare(b.emoji, 'ru'));

    const recent = row.recent
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);

    out[workoutId] = {
      summary,
      myEmoji: row.myEmoji,
      recent,
    };
  }

  return out;
}

export async function GET(request: NextRequest) {
  try {
    const userId = (await requireUser(request)).id;
    const workoutIds = parseWorkoutIds(request);
    if (!workoutIds.length) return NextResponse.json({});

    const byWorkout = await buildReactionMap(userId, workoutIds);
    return NextResponse.json(byWorkout);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('WORKOUT REACTIONS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const authUser = await requireUser(request);
    const userId = authUser.id;
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const workoutId = String(body.workoutId || '').trim();
    const emoji = String(body.emoji || '').trim();

    if (!workoutId) return jsonError('workoutId обязателен');
    if (!ALLOWED_EMOJI_SET.has(emoji)) return jsonError('Недопустимая реакция');

    const workout = await prisma.workout.findUnique({
      where: { id: workoutId },
      select: { id: true, userId: true, reps: true },
    });

    if (!workout) return jsonError('Тренировка не найдена', 404);

    if (workout.userId !== userId) {
      const friendLink = await prisma.friendship.findFirst({
        where: {
          status: 'accepted',
          OR: [
            { userId, friendId: workout.userId },
            { userId: workout.userId, friendId: userId },
          ],
        },
        select: { id: true },
      });

      if (!friendLink) return jsonError('Нет доступа к тренировке', 403);
    }

    const existing = await prisma.workoutReaction.findUnique({
      where: { workoutId_userId: { workoutId, userId } },
      select: { id: true, emoji: true },
    });

    let shouldNotifyOwner = false;
    if (existing?.emoji === emoji) {
      await prisma.workoutReaction.delete({ where: { id: existing.id } });
    } else if (existing) {
      await prisma.workoutReaction.update({
        where: { id: existing.id },
        data: { emoji },
      });
      shouldNotifyOwner = workout.userId !== userId;
    } else {
      await prisma.workoutReaction.create({
        data: { workoutId, userId, emoji },
      });
      shouldNotifyOwner = workout.userId !== userId;
    }

    if (shouldNotifyOwner) {
      const title = 'Новая реакция на тренировку';
      const bodyText = `${authUser.username} ${emoji} на вашу тренировку (${workout.reps})`;
      const link = '/dashboard';
      const tag = `friend-reaction-${workoutId}-${userId}`;

      await prisma.notification.create({
        data: {
          userId: workout.userId,
          type: 'friend_reaction',
          title,
          body: bodyText,
          link,
        },
      }).catch((e) => console.error('WORKOUT REACTION NOTIFICATION CREATE ERROR:', e));

      await sendWebPushToUsers(
        [workout.userId],
        { title, body: bodyText, link, tag },
        'friend_reaction',
      ).catch((e) => console.error('WORKOUT REACTION PUSH ERROR:', e));
    }

    const byWorkout = await buildReactionMap(userId, [workoutId]);
    return NextResponse.json({ workoutId, reaction: byWorkout[workoutId] ?? emptyPayload() });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('WORKOUT REACTIONS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
