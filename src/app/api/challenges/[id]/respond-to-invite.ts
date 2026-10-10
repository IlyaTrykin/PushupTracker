import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { challengeResponseMessage, notifyUsers } from '@/lib/notify';

type InviteAnswer = 'accepted' | 'declined';

// Ответ на приглашение в челлендж (B20): меняется только статус pending, повторное
// нажатие возвращает текущий статус без второго уведомления создателю; передумать
// после ответа нельзя. Уведомление создателю — только in-app, на его языке.
export async function respondToChallengeInvite(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
  answer: InviteAnswer,
) {
  try {
    let user: { id: string; username: string };
    try {
      user = await requireUser(request);
    } catch (e) {
      if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован', code: 'UNAUTHORIZED' }, { status: e.status });
      return NextResponse.json({ error: 'Внутренняя ошибка сервера', code: 'INTERNAL_ERROR' }, { status: 500 });
    }

    const { id } = await ctx.params;

    const participant = await prisma.challengeParticipant.findFirst({
      where: { challengeId: id, userId: user.id },
      select: { id: true, status: true, challenge: { select: { groupId: true, creatorId: true, name: true } } },
    });

    if (!participant) return NextResponse.json({ error: 'Приглашение не найдено', code: 'NOT_FOUND' }, { status: 404 });
    if (participant.challenge.groupId) {
      return NextResponse.json(
        { error: 'В соревнованиях группы участие подтверждается автоматически', code: 'GROUP_CHALLENGE_AUTO_ACCEPTED' },
        { status: 400 },
      );
    }

    if (participant.status === answer) return NextResponse.json({ ok: true, status: answer });
    if (participant.status !== 'pending') {
      return NextResponse.json(
        { error: 'Вы уже ответили на это приглашение', code: 'INVITE_ALREADY_ANSWERED', status: participant.status },
        { status: 409 },
      );
    }

    // Условное обновление: из двух одновременных нажатий уведомление отправит только одно.
    const claimed = await prisma.challengeParticipant.updateMany({
      where: { id: participant.id, status: 'pending' },
      data: { status: answer },
    });
    if (claimed.count === 0) {
      const current = await prisma.challengeParticipant.findUnique({ where: { id: participant.id }, select: { status: true } });
      if (current?.status === answer) return NextResponse.json({ ok: true, status: answer });
      return NextResponse.json(
        { error: 'Вы уже ответили на это приглашение', code: 'INVITE_ALREADY_ANSWERED', status: current?.status ?? null },
        { status: 409 },
      );
    }

    const { creatorId, name } = participant.challenge;
    if (creatorId && creatorId !== user.id) {
      const accepted = answer === 'accepted';
      await notifyUsers(
        [creatorId],
        'challenge_invite',
        (locale) => challengeResponseMessage(locale, { challengeId: id, challengeName: name, username: user.username, accepted }),
        { inAppOnly: true, type: accepted ? 'challenge_accept' : 'challenge_decline' },
      );
    }

    return NextResponse.json({ ok: true, status: answer });
  } catch (e) {
    console.error('CHALLENGE INVITE ANSWER ERROR:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера', code: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
