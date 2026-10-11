import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { type SignupAttribution, signupSourceLabel } from '@/lib/referral';

export type AttributionResult = { inviterId: string | null; source: string };

/**
 * Records where a new user came from. With a valid invite code the inviter and the
 * new user become accepted friends right away. Never throws for bad input: a stale
 * or foreign code simply counts as an organic signup.
 */
export async function applySignupAttribution(userId: string, attribution: SignupAttribution): Promise<AttributionResult> {
  const inviter = attribution.inviteCode
    ? await prisma.user.findFirst({
        where: { inviteCode: attribution.inviteCode, deletedAt: null, NOT: { id: userId } },
        select: { id: true },
      })
    : null;
  const source = signupSourceLabel(attribution, Boolean(inviter));

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        signupSource: source,
        signupUtm: attribution.utm ?? Prisma.DbNull,
        referredById: inviter?.id ?? null,
      },
    });
    if (!inviter) return;
    const existing = await tx.friendship.findFirst({
      where: {
        OR: [
          { userId: inviter.id, friendId: userId },
          { userId, friendId: inviter.id },
        ],
      },
      select: { id: true },
    });
    if (!existing) await tx.friendship.create({ data: { userId: inviter.id, friendId: userId, status: 'accepted' } });
  });

  return { inviterId: inviter?.id ?? null, source };
}
