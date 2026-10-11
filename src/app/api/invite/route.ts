import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publicAppUrl } from '@/lib/public-url';
import { generateInviteCode } from '@/lib/referral';

export const dynamic = 'force-dynamic';

async function ensureInviteCode(userId: string): Promise<string> {
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
  if (existing?.inviteCode) return existing.inviteCode;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateInviteCode();
    try {
      // Only set when still empty: two parallel first requests end up with one code.
      const updated = await prisma.user.updateMany({ where: { id: userId, inviteCode: null }, data: { inviteCode: code } });
      if (updated.count === 1) return code;
      const now = await prisma.user.findUnique({ where: { id: userId }, select: { inviteCode: true } });
      if (now?.inviteCode) return now.inviteCode;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue; // code collision
      throw e;
    }
  }
  throw new Error('Could not allocate an invite code');
}

/** GET → the caller's personal invite link and how many people joined through it. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const code = await ensureInviteCode(user.id);
    const joined = await prisma.user.count({ where: { referredById: user.id, deletedAt: null } });
    const base = publicAppUrl() ?? new URL(request.url).origin;
    return NextResponse.json({ code, url: `${base}/invite/${code}`, joined });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    console.error('INVITE GET ERROR:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
