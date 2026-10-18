import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireAdmin } from '@/lib/auth';
import { parseReportStatus } from '@/lib/reports';

export const dynamic = 'force-dynamic';

const LIST_LIMIT = 200;

function jsonError(message: string, status: number, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

/** GET /api/admin/reports?status=new|reviewed (no status — all) — newest first, admin only. */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const status = parseReportStatus(request.nextUrl.searchParams.get('status'));

    const reports = await prisma.userReport.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      select: {
        id: true,
        context: true,
        contextId: true,
        reason: true,
        text: true,
        status: true,
        createdAt: true,
        reporter: { select: { id: true, username: true } },
        targetUser: { select: { id: true, username: true, deletedAt: true } },
      },
    });

    // Names of the groups reports were made in (contextId of 'group' reports).
    const groupIds = [...new Set(reports.filter((r) => r.context === 'group' && r.contextId).map((r) => r.contextId as string))];
    const groups = groupIds.length
      ? await prisma.group.findMany({ where: { id: { in: groupIds } }, select: { id: true, name: true } })
      : [];
    const groupNames = new Map(groups.map((g) => [g.id, g.name]));

    const counts = await prisma.userReport.groupBy({ by: ['status'], _count: { _all: true } });

    return NextResponse.json({
      reports: reports.map((r) => ({
        id: r.id,
        context: r.context,
        contextId: r.contextId,
        groupName: r.context === 'group' && r.contextId ? groupNames.get(r.contextId) ?? null : null,
        reason: r.reason,
        text: r.text,
        status: r.status,
        createdAt: r.createdAt,
        reporter: r.reporter,
        target: { id: r.targetUser.id, username: r.targetUser.username, deleted: Boolean(r.targetUser.deletedAt) },
      })),
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
    });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status === 403 ? 'Нет доступа' : 'Не авторизован', e.status);
    console.error('ADMIN REPORTS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

/** PATCH /api/admin/reports { id, status: 'new'|'reviewed' } — admin only. */
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const body = await request.json().catch(() => null);
    const record = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
    const id = typeof record.id === 'string' ? record.id.trim() : '';
    const status = parseReportStatus(record.status);
    if (!id || !status) return jsonError('Укажите id и статус (new или reviewed)', 400, 'BAD_INPUT');

    const { count } = await prisma.userReport.updateMany({ where: { id }, data: { status } });
    if (!count) return jsonError('Жалоба не найдена', 404, 'NOT_FOUND');
    return NextResponse.json({ ok: true, id, status });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.status === 403 ? 'Нет доступа' : 'Не авторизован', e.status);
    console.error('ADMIN REPORTS PATCH ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
