import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { BlockError, blockUser, unblockUser } from '@/lib/blocks';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

async function readUserId(request: NextRequest): Promise<string | null> {
  const body = await request.json().catch(() => null);
  const raw = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>).userId : null;
  const userId = typeof raw === 'string' ? raw.trim() : '';
  return userId && userId.length <= 64 ? userId : null;
}

/** GET /api/blocks — people I blocked, newest first (for «Заблокированные» in the profile). */
export async function GET(request: NextRequest) {
  try {
    const me = await requireUser(request);
    const rows = await prisma.userBlock.findMany({
      where: { blockerId: me.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, blocked: { select: { id: true, username: true, avatarPath: true, deletedAt: true } } },
    });
    return NextResponse.json({
      blocks: rows
        .filter((row) => !row.blocked.deletedAt)
        .map((row) => ({
          userId: row.blocked.id,
          username: row.blocked.username,
          avatarPath: row.blocked.avatarPath,
          createdAt: row.createdAt,
        })),
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('BLOCKS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

/** POST /api/blocks { userId } — block; ends the friendship and follows (see src/lib/blocks.ts). Idempotent. */
export async function POST(request: NextRequest) {
  try {
    const me = await requireUser(request);
    const userId = await readUserId(request);
    if (!userId) return jsonError('Не указан пользователь', 400, 'BAD_INPUT');

    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!target || target.deletedAt) return jsonError('Пользователь не найден', 404, 'USER_NOT_FOUND');

    await prisma.$transaction((tx) => blockUser(tx, me.id, target.id));
    return NextResponse.json({ ok: true, blocked: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof BlockError) return jsonError(e.message, e.status, e.code);
    console.error('BLOCKS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

/** DELETE /api/blocks { userId } — unblock (only my own block); nothing else is restored. */
export async function DELETE(request: NextRequest) {
  try {
    const me = await requireUser(request);
    const userId = await readUserId(request);
    if (!userId) return jsonError('Не указан пользователь', 400, 'BAD_INPUT');

    const { removed } = await unblockUser(prisma, me.id, userId);
    return NextResponse.json({ ok: true, blocked: false, removed });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('BLOCKS DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
