import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';


function jsonError(message: string, status: number, details?: string) {
  return NextResponse.json(details ? { error: message, details } : { error: message }, { status });
}

function parseISODateOnly(s: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, (m || 1) - 1, d || 1);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

export async function GET(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const challenges = await prisma.challenge.findMany({
      where: {
        OR: [{ creatorId: userId }, { participants: { some: { userId } } }],
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
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

    // добавить "мой статус" для удобства UI
    const withMyStatus = challenges.map((c) => {
      const mine = c.participants.find((p) => p.userId === userId);
      return { ...c, myStatus: mine?.status ?? null };
    });

    return NextResponse.json(withMyStatus);
  } catch (e: any) {
    console.error('CHALLENGES GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (GET /api/challenges)', 500, e?.message ?? String(e));
  }
}

export async function POST(request: NextRequest) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
      return jsonError('Внутренняя ошибка сервера', 500);
    }

    const bodyText = await request.text();
    let body: any = {};
    try {
      body = bodyText ? JSON.parse(bodyText) : {};
    } catch {
      return jsonError('Некорректный JSON', 400);
    }

    const name = String(body.name || '').trim();
    const exerciseType = String(body.exerciseType || 'pushups').trim() || 'pushups';

    const startDate = parseISODateOnly(String(body.startDate || '').trim());
    const endDate = parseISODateOnly(String(body.endDate || '').trim());

    if (!name) return jsonError('Введите название челленджа', 400);
    if (!startDate || !endDate) return jsonError('Даты должны быть в формате YYYY-MM-DD', 400);
    if (endDate < startDate) return jsonError('endDate не может быть раньше startDate', 400);

    const mode = String(body.mode || 'most').trim(); // most | target | daily_min | sets_min
    if (!['most', 'target', 'daily_min', 'sets_min'].includes(mode)) return jsonError('mode должен быть most, target, daily_min или sets_min', 400);

    let targetReps: number | null = null;
    if (mode === 'target' || mode === 'daily_min' || mode === 'sets_min') {
      const t = Number(body.targetReps);
      if (!Number.isFinite(t) || t <= 0 || !Number.isInteger(t)) {
        return jsonError('targetReps должен быть целым числом > 0', 400);
      }
      targetReps = t;
    }

const participantsUsernames: string[] = Array.isArray(body.participantsUsernames)
      ? body.participantsUsernames.map((x: any) => String(x).trim()).filter(Boolean)
      : [];

    const me = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true },
    });
    if (!me?.username) return jsonError('Пользователь не найден', 404);

    const allUsernames = Array.from(new Set([me.username, ...participantsUsernames]));

    const users = await prisma.user.findMany({
      where: { username: { in: allUsernames } },
      select: { id: true, username: true },
    });

    if (users.length !== allUsernames.length) {
      const found = new Set(users.map((u) => u.username));
      const missing = allUsernames.filter((u) => !found.has(u));
      return jsonError('Некоторые пользователи не найдены', 400, `Не найдены: ${missing.join(', ')}`);
    }

    const created = await prisma.challenge.create({
      data: {
        name,
        exerciseType,
        startDate,
        endDate,
        mode,
        targetReps,
        creatorId: userId,
        participants: {
          create: users.map((u) => ({
            userId: u.id,
            status: u.id === userId ? 'accepted' : 'pending',
          })),
        },
      },
      select: { id: true, name: true },
    });

    
    // Notifications: отправляем приглашения всем участникам со статусом pending
    try {
      const creatorName = me.username;
      const pendingUsers = users.filter((u) => u.id !== userId);
      if (pendingUsers.length) {
        await prisma.notification.createMany({
          data: pendingUsers.map((u) => ({
            userId: u.id,
            type: 'challenge_invite',
            title: 'Приглашение в челлендж',
            body: `${creatorName} пригласил вас в челлендж: ${name}`,
            link: `/challenges/${created.id}`,
          })),
        });
      }
    } catch (e) {
      console.error('NOTIFY INVITE ERROR:', e);
    }

return NextResponse.json(created);
  } catch (e: any) {
    console.error('CHALLENGES POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера (POST /api/challenges)', 500, e?.message ?? String(e));
  }
}
