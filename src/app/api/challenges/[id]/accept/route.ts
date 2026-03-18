import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

export async function POST(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    let userId: string;
    try {
      userId = (await requireUser(request)).id;
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: e.status });
      return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
    }

    const { id } = await ctx.params;

    const cp = await prisma.challengeParticipant.findFirst({
      where: { challengeId: id, userId },
      select: { id: true, status: true },
    });

    if (!cp) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    await prisma.challengeParticipant.update({
      where: { id: cp.id },
      data: { status: 'accepted' },
    });

    const [me, ch] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
      prisma.challenge.findUnique({ where: { id }, select: { creatorId: true, name: true } }),
    ]);

    if (me?.username && ch?.creatorId) {
      await prisma.notification.create({
        data: {
          userId: ch.creatorId,
          type: 'challenge_accept',
          title: 'Invite accepted',
          body: `${me.username} accepted invite: ${ch.name}`,
          link: `/challenges/${id}`,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('ACCEPT ERROR:', e);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: getErrorMessage(e) }, { status: 500 });
  }
}
