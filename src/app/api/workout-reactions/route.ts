import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { friendReactionMessage, notifyUsers } from '@/lib/notify';
import { isUniqueViolation } from '@/lib/groups';

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

async function claimReactionNotification(workoutId: string, userId: string): Promise<boolean> {
  try {
    await prisma.notificationDispatch.create({ data: { key: `friend-reaction:${workoutId}:${userId}` } });
    return true;
  } catch (e) {
    if (isUniqueViolation(e)) return false;
    throw e;
  }
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

    const groupIds = (
      await prisma.groupMembership.findMany({
        where: {
          userId,
          status: 'active',
          group: { deletedAt: null },
        },
        select: { groupId: true },
      })
    ).map((membership) => membership.groupId);

    if (groupIds.length) {
      const peers = await prisma.groupMembership.findMany({
        where: {
          groupId: { in: groupIds },
          status: 'active',
          userId: { in: ownerIds },
          group: { deletedAt: null },
        },
        select: { userId: true },
      });

      for (const peer of peers) {
        accessibleOwners.add(peer.userId);
      }
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
      select: { id: true, userId: true, reps: true, exerciseType: true, loadKg: true, durationSeconds: true },
    });

    if (!workout) return jsonError('Тренировка не найдена', 404);

    if (workout.userId !== userId) {
      const [friendLink, sharedGroup] = await Promise.all([
        prisma.friendship.findFirst({
          where: {
            status: 'accepted',
            OR: [
              { userId, friendId: workout.userId },
              { userId: workout.userId, friendId: userId },
            ],
          },
          select: { id: true },
        }),
        prisma.groupMembership.findFirst({
          where: {
            userId: workout.userId,
            status: 'active',
            group: {
              deletedAt: null,
              memberships: {
                some: {
                  userId,
                  status: 'active',
                },
              },
            },
          },
          select: { id: true },
        }),
      ]);

      if (!friendLink && !sharedGroup) return jsonError('Нет доступа к тренировке', 403);
    }

    const existing = await prisma.workoutReaction.findUnique({
      where: { workoutId_userId: { workoutId, userId } },
      select: { id: true, emoji: true },
    });

    // Владельца уведомляем один раз на пару (тренировка, автор реакции): смена эмодзи
    // и «снять → поставить снова» не шлют повторный push (S05, B21).
    let reacted = false;
    if (existing?.emoji === emoji) {
      await prisma.workoutReaction.deleteMany({ where: { id: existing.id } });
    } else if (existing) {
      await prisma.workoutReaction.updateMany({
        where: { id: existing.id },
        data: { emoji },
      });
    } else {
      try {
        await prisma.workoutReaction.create({
          data: { workoutId, userId, emoji },
        });
        reacted = true;
      } catch (e) {
        // Двойной тап: реакция уже создана параллельным запросом — отдаём текущее состояние.
        if (!isUniqueViolation(e)) throw e;
      }
    }

    if (reacted && workout.userId !== userId) {
      // Реакция уже сохранена: сбой маркера или уведомления не превращает ответ в 500.
      try {
        if (await claimReactionNotification(workoutId, userId)) {
          // In-app сразу; push / письмо / Telegram — по настройкам владельца, текст на его языке.
          await notifyUsers(
            [workout.userId],
            'friend_reaction',
            (locale) => friendReactionMessage(locale, { username: authUser.username, emoji, workout }),
            { tag: `friend-reaction-${workoutId}-${userId}` },
          );
        }
      } catch (e) {
        console.error('WORKOUT REACTION NOTIFY ERROR:', e);
      }
    }

    const byWorkout = await buildReactionMap(userId, [workoutId]);
    return NextResponse.json({ workoutId, reaction: byWorkout[workoutId] ?? emptyPayload() });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('WORKOUT REACTIONS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
