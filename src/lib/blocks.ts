/**
 * Blocking users (R33.1). A block works both ways: whoever blocked whom, the two do not see each
 * other in friends' feeds, the league, the comparison and reactions, and the server refuses friend
 * requests, group join requests and challenge invitations between them.
 *
 * Blocking also ends what connects the two: the friendship (or a pending request), follows and
 * comparison hides of both sides, pending personal challenge invitations between them (declined)
 * and pending join requests to a group the other one owns (rejected). Unblocking restores none of it.
 *
 * Functions take the part of Prisma they use (`prisma` or a transaction client fits as is).
 */

export type BlockPair = { blockerId: string; blockedId: string };
type IdFilter = string | { in: string[] };
export type BlockWhere = { OR: Array<{ blockerId?: IdFilter; blockedId?: IdFilter }> };

export type BlockReadDb = {
  userBlock: { findMany(args: { where: BlockWhere; select: { blockerId: true; blockedId: true } }): Promise<BlockPair[]> };
};

type PairOr<K extends string, L extends string> = { where: { OR: Array<Record<K | L, string>> } };

export type BlockWriteDb = {
  userBlock: BlockReadDb['userBlock'] & {
    createMany(args: { data: BlockPair[]; skipDuplicates: true }): Promise<unknown>;
    deleteMany(args: { where: BlockPair }): Promise<{ count: number }>;
  };
  friendship: { deleteMany(args: PairOr<'userId', 'friendId'>): Promise<unknown> };
  friendFollow: { deleteMany(args: PairOr<'followerId', 'friendId'>): Promise<unknown> };
  friendComparisonHide: { deleteMany(args: PairOr<'userId', 'friendId'>): Promise<unknown> };
  challengeParticipant: {
    updateMany(args: {
      where: { status: 'pending'; OR: Array<{ userId: string; challenge: { creatorId: string; groupId: null } }> };
      data: { status: 'declined' };
    }): Promise<unknown>;
  };
  groupJoinRequest: {
    updateMany(args: {
      where: { status: 'pending'; OR: Array<{ userId: string; group: { ownerId: string } }> };
      data: { status: 'rejected'; resolvedAt: Date };
    }): Promise<unknown>;
  };
};

export type BlockErrorCode = 'BLOCK_SELF' | 'USER_BLOCKED';

export class BlockError extends Error {
  constructor(
    public readonly code: BlockErrorCode,
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'BlockError';
  }
}

/** Both orders of a pair, for the `OR` of a symmetric delete. */
function bothWays<K extends string, L extends string>(k: K, l: L, a: string, b: string): Array<Record<K | L, string>> {
  return [
    { [k]: a, [l]: b } as Record<K | L, string>,
    { [k]: b, [l]: a } as Record<K | L, string>,
  ];
}

/** `blockerId` blocks `blockedId`; idempotent. Run it in a transaction (`prisma.$transaction(tx => blockUser(tx, …))`). */
export async function blockUser(db: BlockWriteDb, blockerId: string, blockedId: string, now: Date = new Date()): Promise<void> {
  if (blockerId === blockedId) throw new BlockError('BLOCK_SELF', 400, 'Нельзя заблокировать самого себя');

  await db.userBlock.createMany({ data: [{ blockerId, blockedId }], skipDuplicates: true });
  await db.friendship.deleteMany({ where: { OR: bothWays('userId', 'friendId', blockerId, blockedId) } });
  await db.friendFollow.deleteMany({ where: { OR: bothWays('followerId', 'friendId', blockerId, blockedId) } });
  await db.friendComparisonHide.deleteMany({ where: { OR: bothWays('userId', 'friendId', blockerId, blockedId) } });
  await db.challengeParticipant.updateMany({
    where: {
      status: 'pending',
      OR: [
        { userId: blockerId, challenge: { creatorId: blockedId, groupId: null } },
        { userId: blockedId, challenge: { creatorId: blockerId, groupId: null } },
      ],
    },
    data: { status: 'declined' },
  });
  await db.groupJoinRequest.updateMany({
    where: {
      status: 'pending',
      OR: [
        { userId: blockedId, group: { ownerId: blockerId } },
        { userId: blockerId, group: { ownerId: blockedId } },
      ],
    },
    data: { status: 'rejected', resolvedAt: now },
  });
}

/** Removes my block of `blockedId` (not theirs of me). */
export async function unblockUser(db: BlockWriteDb, blockerId: string, blockedId: string): Promise<{ removed: boolean }> {
  const { count } = await db.userBlock.deleteMany({ where: { blockerId, blockedId } });
  return { removed: count > 0 };
}

/**
 * Users `userId` blocked or was blocked by. With `among`, only those ids are looked at
 * (an empty list gives an empty set without a query).
 */
export async function loadBlockedPeerIds(db: BlockReadDb, userId: string, among?: string[]): Promise<Set<string>> {
  if (among && !among.length) return new Set();
  const others: IdFilter | undefined = among ? { in: among } : undefined;
  const rows = await db.userBlock.findMany({
    where: {
      OR: [
        { blockerId: userId, ...(others ? { blockedId: others } : {}) },
        { blockedId: userId, ...(others ? { blockerId: others } : {}) },
      ],
    },
    select: { blockerId: true, blockedId: true },
  });
  const peers = new Set<string>();
  for (const row of rows) {
    if (row.blockerId === userId) peers.add(row.blockedId);
    if (row.blockedId === userId) peers.add(row.blockerId);
  }
  peers.delete(userId);
  return peers;
}

/** True when either of the two blocked the other. */
export async function isBlockedBetween(db: BlockReadDb, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  return (await loadBlockedPeerIds(db, a, [b])).has(b);
}

/** Throws `BlockError('USER_BLOCKED', 403)` when either of the two blocked the other. */
export async function assertNotBlocked(db: BlockReadDb, a: string, b: string): Promise<void> {
  if (await isBlockedBetween(db, a, b)) {
    throw new BlockError('USER_BLOCKED', 403, 'Действие недоступно: пользователь заблокирован');
  }
}

/** Reactions without those of people the viewer blocked or was blocked by. */
export function visibleReactions<T extends { userId: string }>(reactions: T[], blocked: ReadonlySet<string>): T[] {
  return blocked.size ? reactions.filter((reaction) => !blocked.has(reaction.userId)) : reactions;
}
