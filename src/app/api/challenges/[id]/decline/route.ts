import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

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
      select: { id: true },
    });

    if (!cp) return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 });

    await prisma.challengeParticipant.update({
      where: { id: cp.id },
      data: { status: 'declined' },
    });

    const [me, ch] = await Promise.all([
      prisma.user.findUnique({ where: { id: userId }, select: { username: true } }),
      prisma.challenge.findUnique({ where: { id }, select: { creatorId: true, name: true } }),
    ]);

    if (me?.username && ch?.creatorId) {
      await prisma.notification.create({
        data: {
          userId: ch.creatorId,
          type: 'challenge_decline',
          title: 'Invite declined',
          body: `${me.username} declined invite: ${ch.name}`,
          link: `/challenges/${id}`,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('DECLINE ERROR:', e);
    return NextResponse.json({ error: 'INTERNAL_ERROR', details: e?.message ?? String(e) }, { status: 500 });
  }
}
