import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';


export async function GET(request: NextRequest) {
  let userId: string;
  try { userId = (await requireUser(request)).id; } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }

  const items = await prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  const unreadCount = await prisma.notification.count({
    where: { userId, isRead: false },
  });

  return NextResponse.json({ unreadCount, items });
}
