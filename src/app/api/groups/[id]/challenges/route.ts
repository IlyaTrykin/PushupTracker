import { NextRequest, NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { GroupError, getGroupWorkoutScope, recordGroupAuditLog, requireGroupManageAccess } from '@/lib/groups';
import { prisma } from '@/lib/prisma';

type JsonObject = Record<string, unknown>;

function jsonError(message: string, status: number, code?: string, details?: Record<string, unknown>) {
  return NextResponse.json(code ? { error: message, code, details } : { error: message, details }, { status });
}

function parseISODateOnly(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

const ALLOWED_EXERCISES = new Set(['pushups', 'pullups', 'crunches', 'squats', 'plank']);

export async function GET(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id } = await ctx.params;
    await getGroupWorkoutScope(actor, id);

    const challenges = await prisma.challenge.findMany({
      where: { groupId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        groupId: true,
        exerciseType: true,
        mode: true,
        targetReps: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        creatorId: true,
        creator: { select: { username: true } },
        participants: {
          select: {
            userId: true,
            status: true,
            user: { select: { username: true } },
          },
        },
      },
    });

    return NextResponse.json(challenges);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP CHALLENGES GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser(request);
    const { id } = await ctx.params;
    await requireGroupManageAccess(prisma, actor, id);

    const bodyText = await request.text();
    let body: JsonObject = {};
    try {
      const parsed = bodyText ? JSON.parse(bodyText) : {};
      body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
    } catch {
      return jsonError('Некорректный JSON', 400, 'BAD_JSON');
    }

    const name = String(body.name || '').trim();
    const exerciseType = String(body.exerciseType || 'pushups').trim() || 'pushups';
    const startDate = parseISODateOnly(String(body.startDate || '').trim());
    const endDate = parseISODateOnly(String(body.endDate || '').trim());

    if (!name) return jsonError('Введите название соревнования', 400);
    if (!ALLOWED_EXERCISES.has(exerciseType)) return jsonError('Некорректный тип упражнения', 400);
    if (!startDate || !endDate) return jsonError('Даты должны быть в формате YYYY-MM-DD', 400);
    if (endDate < startDate) return jsonError('endDate не может быть раньше startDate', 400);

    const mode = String(body.mode || 'most').trim();
    if (!['most', 'target', 'daily_min', 'sets_min'].includes(mode)) {
      return jsonError('mode должен быть most, target, daily_min или sets_min', 400);
    }

    let targetReps: number | null = null;
    if (mode === 'target' || mode === 'daily_min' || mode === 'sets_min') {
      const target = Number(body.targetReps);
      if (!Number.isFinite(target) || target <= 0 || !Number.isInteger(target)) {
        return jsonError('targetReps должен быть целым числом > 0', 400);
      }
      targetReps = target;
    }

    const { members } = await getGroupWorkoutScope(actor, id);
    const participantIds = members.map((membership) => membership.userId);
    if (!participantIds.length) return jsonError('В группе нет участников для соревнования', 400, 'GROUP_CHALLENGE_EMPTY');

    const created = await prisma.challenge.create({
      data: {
        name,
        groupId: id,
        exerciseType,
        startDate,
        endDate,
        mode,
        targetReps,
        creatorId: actor.id,
        participants: {
          create: participantIds.map((userId) => ({
            userId,
            status: 'accepted',
          })),
        },
      },
      select: { id: true, name: true, groupId: true },
    });

    await recordGroupAuditLog({
      groupId: id,
      actorId: actor.id,
      action: 'group_challenge_created',
      entityType: 'challenge',
      entityId: created.id,
      metadata: {
        name,
        exerciseType,
        mode,
        targetReps,
        participantCount: participantIds.length,
      },
    });

    return NextResponse.json(created);
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof GroupError) return jsonError(e.message, e.status, e.code, e.details);
    console.error('GROUP CHALLENGES POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
