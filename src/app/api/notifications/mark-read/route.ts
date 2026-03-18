import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

type JsonObject = Record<string, unknown>;

export async function POST(request: NextRequest) {
  let userId: string;
  try { userId = (await requireUser(request)).id; } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }

  const text = await request.text();
  let body: JsonObject = {};
  try {
    const parsed = text ? JSON.parse(text) : {};
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
  } catch {}

  const id = typeof body.id === 'string' ? body.id : null;
  const all = body.all === true;

  if (!id && !all) return NextResponse.json({ error: 'Нужно передать id или all=true' }, { status: 400 });

  if (all) {
    await prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return NextResponse.json({ ok: true });
  }

  if (!id) return NextResponse.json({ error: 'Нужно передать id' }, { status: 400 });

  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n || n.userId !== userId) return NextResponse.json({ error: 'Не найдено' }, { status: 404 });

  await prisma.notification.update({ where: { id }, data: { isRead: true } });
  return NextResponse.json({ ok: true });
}
