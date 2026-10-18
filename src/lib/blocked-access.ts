/**
 * Server-side refusals and filters for blocked users (R33.1) as the API routes use them.
 *
 * Each function does the whole step its route needs (loads the rows and returns what the route
 * works on), so the block check cannot be left out of a route without the route losing that step.
 * Functions take the part of Prisma they use (`prisma` or a transaction client fits as is).
 */

import { loadBlockedPeerIds, isBlockedBetween, type BlockReadDb } from '@/lib/blocks';
import { CHALLENGE_PARTICIPANTS_MAX, splitChallengeInvitees } from '@/lib/challenge-scoring';

type EitherSide = { OR: Array<{ userId: string } | { friendId: string }> };

// --- /api/friends GET: the friend list (and the comparison table on /friends) ---

// Чужой email в ответах не отдаём (S04): только ник и аватар.
const friendUserSelect = { id: true, username: true, avatarPath: true, deletedAt: true } as const;

export type FriendDirectoryUser = { id: string; username: string; avatarPath: string | null; deletedAt: Date | null };

export type FriendListItem = {
  friendshipId: string;
  userId: string;
  username: string;
  avatarPath: string | null;
  since: Date;
  isFollowing: boolean;
  /** Hidden by the caller from the comparison table on /friends; still a friend everywhere else. */
  hiddenInComparison: boolean;
};

export type FriendListDb = BlockReadDb & {
  friendship: {
    findMany(args: {
      where: { status: 'accepted' } & EitherSide;
      include: { user: { select: typeof friendUserSelect }; friend: { select: typeof friendUserSelect } };
      orderBy: { createdAt: 'asc' };
    }): Promise<Array<{ id: string; userId: string; createdAt: Date; user: FriendDirectoryUser; friend: FriendDirectoryUser }>>;
  };
  friendFollow: {
    findMany(args: { where: { followerId: string; friendId: { in: string[] } }; select: { friendId: true } }): Promise<Array<{ friendId: string }>>;
  };
  friendComparisonHide: {
    findMany(args: { where: { userId: string; friendId: { in: string[] } }; select: { friendId: true } }): Promise<Array<{ friendId: string }>>;
  };
};

/** Accepted friends of `userId`, oldest first, without deleted accounts and anyone blocked either way. */
export async function loadFriendList(db: FriendListDb, userId: string): Promise<FriendListItem[]> {
  const friendships = await db.friendship.findMany({
    where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
    include: { user: { select: friendUserSelect }, friend: { select: friendUserSelect } },
    orderBy: { createdAt: 'asc' },
  });

  const friendIds: string[] = [];
  const base: FriendListItem[] = [];
  for (const f of friendships) {
    const other = f.userId === userId ? f.friend : f.user;
    if (other.deletedAt) continue;
    friendIds.push(other.id);
    base.push({
      friendshipId: f.id,
      userId: other.id,
      username: other.username,
      avatarPath: other.avatarPath ?? null,
      since: f.createdAt,
      isFollowing: false,
      hiddenInComparison: false,
    });
  }

  // Blocked in either direction: not in the list or the comparison table.
  const blocked = await loadBlockedPeerIds(db, userId, friendIds);
  const visible = base.filter((row) => !blocked.has(row.userId));
  if (!visible.length) return [];

  const [follows, hides] = await Promise.all([
    db.friendFollow.findMany({ where: { followerId: userId, friendId: { in: friendIds } }, select: { friendId: true } }),
    db.friendComparisonHide.findMany({ where: { userId, friendId: { in: friendIds } }, select: { friendId: true } }),
  ]);
  const following = new Set(follows.map((x) => x.friendId));
  const hidden = new Set(hides.map((x) => x.friendId));
  return visible.map((r) => ({ ...r, isFollowing: following.has(r.userId), hiddenInComparison: hidden.has(r.userId) }));
}

// --- /api/friends/workouts GET: whose workouts the feed and the comparison show ---

export type FeedUsersDb = BlockReadDb & {
  friendship: {
    findMany(args: { where: { status: 'accepted' } & EitherSide; select: { userId: true; friendId: true } }): Promise<Array<{ userId: string; friendId: string }>>;
  };
};

/** `userId` and the accepted friends, without anyone blocked in either direction. */
export async function loadFeedUserIds(db: FeedUsersDb, userId: string): Promise<string[]> {
  const friendships = await db.friendship.findMany({
    where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
    select: { userId: true, friendId: true },
  });
  const ids = new Set<string>([userId]);
  for (const f of friendships) {
    ids.add(f.userId);
    ids.add(f.friendId);
  }
  const blocked = await loadBlockedPeerIds(db, userId, Array.from(ids));
  return Array.from(ids).filter((id) => !blocked.has(id));
}

// --- /api/challenges POST: whom a new personal challenge invites ---

const inviteeUserSelect = { id: true, username: true, deletedAt: true } as const;
type InviteeUser = { id: string; username: string; deletedAt: Date | null };

export type ChallengeInviteesDb = BlockReadDb & {
  friendship: {
    findMany(args: {
      where: { status: 'accepted' } & EitherSide;
      select: { userId: true; user: { select: typeof inviteeUserSelect }; friend: { select: typeof inviteeUserSelect } };
    }): Promise<Array<{ userId: string; user: InviteeUser; friend: InviteeUser }>>;
  };
};

export type ChallengeInviteesResult =
  | { ok: true; invitedIds: string[] }
  | { ok: false; status: 400 | 403; error: string; details?: string; code: 'CHALLENGE_NOT_FRIENDS' | 'CHALLENGE_TOO_MANY_PARTICIPANTS' | 'USER_BLOCKED' };

/**
 * Ids of the requested usernames: only accepted friends that are not deleted (unknown names are «not
 * friends» too), at most `CHALLENGE_PARTICIPANTS_MAX` with the creator, nobody blocked either way.
 */
export async function resolveChallengeInvitees(
  db: ChallengeInviteesDb,
  creator: { id: string; username: string },
  requestedUsernames: string[],
): Promise<ChallengeInviteesResult> {
  const userId = creator.id;
  const friendships = await db.friendship.findMany({
    where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
    select: { userId: true, user: { select: inviteeUserSelect }, friend: { select: inviteeUserSelect } },
  });
  const friends = new Map<string, string>(); // username → id
  for (const f of friendships) {
    const other = f.userId === userId ? f.friend : f.user;
    if (!other.deletedAt) friends.set(other.username, other.id);
  }

  const { invited, notFriends } = splitChallengeInvitees(requestedUsernames, Array.from(friends.keys()), creator.username);
  if (notFriends.length) {
    const shown = notFriends.slice(0, 20).join(', ') + (notFriends.length > 20 ? '…' : '');
    return { ok: false, status: 400, error: 'Пригласить можно только друзей', details: `Не в друзьях: ${shown}`, code: 'CHALLENGE_NOT_FRIENDS' };
  }
  if (invited.length + 1 > CHALLENGE_PARTICIPANTS_MAX) {
    return {
      ok: false,
      status: 400,
      error: `В соревновании может быть не больше ${CHALLENGE_PARTICIPANTS_MAX} участников`,
      code: 'CHALLENGE_TOO_MANY_PARTICIPANTS',
    };
  }

  const invitedIds = invited.map((username) => friends.get(username) as string);
  // Nobody blocked in either direction can be invited.
  const blocked = await loadBlockedPeerIds(db, userId, invitedIds);
  if (blocked.size) return { ok: false, status: 403, error: 'Пригласить этого пользователя нельзя', code: 'USER_BLOCKED' };
  return { ok: true, invitedIds };
}

// --- /api/challenges/[id]/accept|decline: answering a personal invitation ---

export type InviteAnswer = 'accepted' | 'declined';

export type InviteParticipant = { id: string; status: string; challenge: { groupId: string | null; creatorId: string; name: string } };

export type InviteAnswerDb = BlockReadDb & {
  challengeParticipant: {
    findFirst(args: {
      where: { challengeId: string; userId: string };
      select: { id: true; status: true; challenge: { select: { groupId: true; creatorId: true; name: true } } };
    }): Promise<InviteParticipant | null>;
  };
};

export type InviteAnswerStep =
  | { kind: 'respond'; status: number; body: Record<string, unknown> }
  | { kind: 'proceed'; participant: InviteParticipant };

/**
 * The invitation `userId` answers, or the answer to give at once: not found, a group challenge
 * (auto participation), the same answer again (no-op), or an invitation from someone blocked
 * in either direction, which cannot be accepted (declining stays possible).
 */
export async function prepareInviteAnswer(db: InviteAnswerDb, challengeId: string, userId: string, answer: InviteAnswer): Promise<InviteAnswerStep> {
  const participant = await db.challengeParticipant.findFirst({
    where: { challengeId, userId },
    select: { id: true, status: true, challenge: { select: { groupId: true, creatorId: true, name: true } } },
  });

  if (!participant) return { kind: 'respond', status: 404, body: { error: 'Приглашение не найдено', code: 'NOT_FOUND' } };
  if (participant.challenge.groupId) {
    return {
      kind: 'respond',
      status: 400,
      body: { error: 'В соревнованиях группы участие подтверждается автоматически', code: 'GROUP_CHALLENGE_AUTO_ACCEPTED' },
    };
  }
  if (participant.status === answer) return { kind: 'respond', status: 200, body: { ok: true, status: answer } };

  const inviterId = participant.challenge.creatorId;
  if (answer === 'accepted' && inviterId && inviterId !== userId && (await isBlockedBetween(db, userId, inviterId))) {
    return { kind: 'respond', status: 403, body: { error: 'Принять приглашение нельзя: пользователь заблокирован', code: 'USER_BLOCKED' } };
  }
  return { kind: 'proceed', participant };
}

// --- /api/workout-reactions POST: who may react to a workout ---

export type ReactionAccessDb = BlockReadDb & {
  friendship: {
    findFirst(args: {
      where: { status: 'accepted'; OR: Array<{ userId: string; friendId: string }> };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
  groupMembership: {
    findFirst(args: {
      where: {
        userId: string;
        status: 'active';
        group: { deletedAt: null; memberships: { some: { userId: string; status: 'active' } } };
      };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * `userId` may react to a workout of `ownerId`: their own, or a friend's or a fellow group member's —
 * never one of someone blocked in either direction.
 */
export async function canReactToWorkout(db: ReactionAccessDb, userId: string, ownerId: string): Promise<boolean> {
  if (ownerId === userId) return true;
  if (await isBlockedBetween(db, userId, ownerId)) return false;
  const [friendLink, sharedGroup] = await Promise.all([
    db.friendship.findFirst({
      where: {
        status: 'accepted',
        OR: [
          { userId, friendId: ownerId },
          { userId: ownerId, friendId: userId },
        ],
      },
      select: { id: true },
    }),
    db.groupMembership.findFirst({
      where: {
        userId: ownerId,
        status: 'active',
        group: { deletedAt: null, memberships: { some: { userId, status: 'active' } } },
      },
      select: { id: true },
    }),
  ]);
  return Boolean(friendLink || sharedGroup);
}
