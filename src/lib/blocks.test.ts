import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BlockError,
  assertNotBlocked,
  blockUser,
  isBlockedBetween,
  loadBlockedPeerIds,
  unblockUser,
  visibleReactions,
  type BlockPair,
  type BlockWriteDb,
} from './blocks';
import { loadFriendIds, type LeagueFriendsDb } from './league';

type Friendship = { id: string; userId: string; friendId: string; status: string };
type Follow = { followerId: string; friendId: string };
type Hide = { userId: string; friendId: string };
type Participant = { challengeId: string; userId: string; status: string };
type Challenge = { id: string; creatorId: string; groupId: string | null };
type JoinRequest = { id: string; userId: string; groupId: string; status: string; resolvedAt: Date | null };
type Group = { id: string; ownerId: string };

type Seed = {
  blocks?: BlockPair[];
  friendships?: Friendship[];
  follows?: Follow[];
  hides?: Hide[];
  challenges?: Challenge[];
  participants?: Participant[];
  groups?: Group[];
  joinRequests?: JoinRequest[];
  users?: Array<{ id: string; deletedAt?: Date | null }>;
};

type IdFilter = string | { in: string[] } | undefined;
const idMatches = (value: string, filter: IdFilter) =>
  filter === undefined || (typeof filter === 'string' ? value === filter : filter.in.includes(value));

/** In-memory tables with Prisma's semantics for the calls `blocks.ts` and `loadFriendIds` make. */
function world(seed: Seed = {}) {
  const t = {
    blocks: [...(seed.blocks ?? [])],
    friendships: [...(seed.friendships ?? [])],
    follows: [...(seed.follows ?? [])],
    hides: [...(seed.hides ?? [])],
    challenges: [...(seed.challenges ?? [])],
    participants: (seed.participants ?? []).map((row) => ({ ...row })),
    groups: [...(seed.groups ?? [])],
    joinRequests: (seed.joinRequests ?? []).map((row) => ({ ...row })),
    users: (seed.users ?? []).map((row) => ({ deletedAt: null, ...row })),
  };
  const pairIn = <R>(rows: R[], or: Array<Partial<R>>) =>
    rows.filter((row) => or.some((cond) => Object.entries(cond).every(([k, v]) => (row as Record<string, unknown>)[k] === v)));
  const remove = <R>(rows: R[], hit: R[]) => {
    for (const row of hit) rows.splice(rows.indexOf(row), 1);
    return { count: hit.length };
  };

  const db: BlockWriteDb & LeagueFriendsDb = {
    userBlock: {
      findMany: async ({ where }) =>
        t.blocks
          .filter((row) => where.OR.some((cond) => idMatches(row.blockerId, cond.blockerId) && idMatches(row.blockedId, cond.blockedId)))
          .map((row) => ({ ...row })),
      createMany: async ({ data }) => {
        for (const row of data) {
          if (!t.blocks.some((b) => b.blockerId === row.blockerId && b.blockedId === row.blockedId)) t.blocks.push({ ...row });
        }
        return {};
      },
      deleteMany: async ({ where }) =>
        remove(t.blocks, t.blocks.filter((b) => b.blockerId === where.blockerId && b.blockedId === where.blockedId)),
    },
    friendship: {
      deleteMany: async ({ where }) => remove(t.friendships, pairIn(t.friendships, where.OR)),
      findMany: async ({ where }) =>
        t.friendships
          .filter((row) => row.status === where.status && where.OR.some((cond) => ('userId' in cond ? row.userId === cond.userId : row.friendId === cond.friendId)))
          .map((row) => ({ userId: row.userId, friendId: row.friendId })),
    },
    friendFollow: { deleteMany: async ({ where }) => remove(t.follows, pairIn(t.follows, where.OR)) },
    friendComparisonHide: { deleteMany: async ({ where }) => remove(t.hides, pairIn(t.hides, where.OR)) },
    challengeParticipant: {
      updateMany: async ({ where, data }) => {
        const hit = t.participants.filter((p) => {
          if (p.status !== where.status) return false;
          const challenge = t.challenges.find((c) => c.id === p.challengeId);
          return where.OR.some(
            (cond) => p.userId === cond.userId && challenge?.creatorId === cond.challenge.creatorId && challenge?.groupId === cond.challenge.groupId,
          );
        });
        for (const p of hit) Object.assign(p, data);
        return { count: hit.length };
      },
    },
    groupJoinRequest: {
      updateMany: async ({ where, data }) => {
        const hit = t.joinRequests.filter((r) => {
          if (r.status !== where.status) return false;
          const group = t.groups.find((g) => g.id === r.groupId);
          return where.OR.some((cond) => r.userId === cond.userId && group?.ownerId === cond.group.ownerId);
        });
        for (const r of hit) Object.assign(r, data);
        return { count: hit.length };
      },
    },
    user: {
      findMany: async ({ where }) =>
        t.users.filter((u) => where.id.in.includes(u.id) && u.deletedAt === where.deletedAt).map((u) => ({ id: u.id })),
    },
  };
  return { db, t };
}

const NOW = new Date('2026-10-18T12:00:00.000Z');

test('blocking removes the friendship in either direction and any pending request', async () => {
  const { db, t } = world({
    friendships: [
      { id: 'f1', userId: 'ann', friendId: 'bob', status: 'accepted' },
      { id: 'f2', userId: 'cat', friendId: 'ann', status: 'pending' },
      { id: 'f3', userId: 'ann', friendId: 'dan', status: 'accepted' },
    ],
  });
  await blockUser(db, 'ann', 'bob', NOW);
  await blockUser(db, 'ann', 'cat', NOW);
  assert.deepEqual(t.friendships.map((f) => f.id), ['f3']);
  assert.deepEqual(t.blocks, [
    { blockerId: 'ann', blockedId: 'bob' },
    { blockerId: 'ann', blockedId: 'cat' },
  ]);
});

test('blocking removes follows and comparison hides of both sides, others stay', async () => {
  const { db, t } = world({
    follows: [
      { followerId: 'ann', friendId: 'bob' },
      { followerId: 'bob', friendId: 'ann' },
      { followerId: 'ann', friendId: 'dan' },
    ],
    hides: [
      { userId: 'bob', friendId: 'ann' },
      { userId: 'dan', friendId: 'ann' },
    ],
  });
  await blockUser(db, 'ann', 'bob', NOW);
  assert.deepEqual(t.follows, [{ followerId: 'ann', friendId: 'dan' }]);
  assert.deepEqual(t.hides, [{ userId: 'dan', friendId: 'ann' }]);
});

test('blocking declines pending personal challenge invitations between the two, not group ones', async () => {
  const { db, t } = world({
    challenges: [
      { id: 'c-bob', creatorId: 'bob', groupId: null },
      { id: 'c-ann', creatorId: 'ann', groupId: null },
      { id: 'c-group', creatorId: 'bob', groupId: 'g1' },
      { id: 'c-dan', creatorId: 'dan', groupId: null },
    ],
    participants: [
      { challengeId: 'c-bob', userId: 'ann', status: 'pending' },
      { challengeId: 'c-ann', userId: 'bob', status: 'pending' },
      { challengeId: 'c-group', userId: 'ann', status: 'pending' },
      { challengeId: 'c-dan', userId: 'ann', status: 'pending' },
    ],
  });
  await blockUser(db, 'ann', 'bob', NOW);
  assert.deepEqual(
    t.participants.map((p) => `${p.challengeId}:${p.userId}:${p.status}`),
    ['c-bob:ann:declined', 'c-ann:bob:declined', 'c-group:ann:pending', 'c-dan:ann:pending'],
  );
});

test('blocking rejects pending join requests to a group the other one owns', async () => {
  const { db, t } = world({
    groups: [
      { id: 'g-ann', ownerId: 'ann' },
      { id: 'g-bob', ownerId: 'bob' },
      { id: 'g-dan', ownerId: 'dan' },
    ],
    joinRequests: [
      { id: 'r1', userId: 'bob', groupId: 'g-ann', status: 'pending', resolvedAt: null },
      { id: 'r2', userId: 'ann', groupId: 'g-bob', status: 'pending', resolvedAt: null },
      { id: 'r3', userId: 'bob', groupId: 'g-dan', status: 'pending', resolvedAt: null },
    ],
  });
  await blockUser(db, 'ann', 'bob', NOW);
  assert.deepEqual(
    t.joinRequests.map((r) => `${r.id}:${r.status}`),
    ['r1:rejected', 'r2:rejected', 'r3:pending'],
  );
  assert.equal(t.joinRequests[0].resolvedAt?.toISOString(), NOW.toISOString());
});

test('blocking twice keeps one row; blocking yourself is refused', async () => {
  const { db, t } = world();
  await blockUser(db, 'ann', 'bob', NOW);
  await blockUser(db, 'ann', 'bob', NOW);
  assert.equal(t.blocks.length, 1);
  await assert.rejects(blockUser(db, 'ann', 'ann', NOW), (e: unknown) => e instanceof BlockError && e.code === 'BLOCK_SELF');
  assert.equal(t.blocks.length, 1);
});

test('unblocking removes only my own block; the other side keeps theirs', async () => {
  const { db, t } = world({
    blocks: [
      { blockerId: 'ann', blockedId: 'bob' },
      { blockerId: 'bob', blockedId: 'ann' },
    ],
  });
  assert.deepEqual(await unblockUser(db, 'ann', 'bob'), { removed: true });
  assert.deepEqual(t.blocks, [{ blockerId: 'bob', blockedId: 'ann' }]);
  assert.deepEqual(await unblockUser(db, 'ann', 'bob'), { removed: false });
  // Still blocked: bob's block works both ways.
  assert.equal(await isBlockedBetween(db, 'ann', 'bob'), true);
});

test('a block works both ways: requests and invitations are refused from the blocker and the blocked', async () => {
  const { db } = world({ blocks: [{ blockerId: 'ann', blockedId: 'bob' }] });
  // Friend request, group join request and challenge invitation all go through this guard.
  for (const [from, to] of [
    ['bob', 'ann'],
    ['ann', 'bob'],
  ]) {
    await assert.rejects(
      assertNotBlocked(db, from, to),
      (e: unknown) => e instanceof BlockError && e.code === 'USER_BLOCKED' && e.status === 403,
    );
  }
  await assertNotBlocked(db, 'bob', 'dan');
  await assertNotBlocked(db, 'dan', 'ann');
});

test('blocked peers are found in both directions, optionally among given ids', async () => {
  const { db } = world({
    blocks: [
      { blockerId: 'ann', blockedId: 'bob' },
      { blockerId: 'cat', blockedId: 'ann' },
      { blockerId: 'dan', blockedId: 'eve' },
    ],
  });
  assert.deepEqual([...(await loadBlockedPeerIds(db, 'ann'))].sort(), ['bob', 'cat']);
  assert.deepEqual([...(await loadBlockedPeerIds(db, 'ann', ['cat', 'dan']))], ['cat']);
  assert.deepEqual([...(await loadBlockedPeerIds(db, 'ann', []))], []);
  assert.deepEqual([...(await loadBlockedPeerIds(db, 'eve'))], ['dan']);
});

test('league and feed friends leave out a friend I blocked and a friend who blocked me', async () => {
  const { db } = world({
    users: [{ id: 'ann' }, { id: 'bob' }, { id: 'cat' }, { id: 'dan' }, { id: 'old', deletedAt: new Date('2026-01-01') }],
    friendships: [
      { id: 'f1', userId: 'ann', friendId: 'bob', status: 'accepted' },
      { id: 'f2', userId: 'cat', friendId: 'ann', status: 'accepted' },
      { id: 'f3', userId: 'ann', friendId: 'dan', status: 'accepted' },
      { id: 'f4', userId: 'ann', friendId: 'old', status: 'accepted' },
    ],
    // Rows left from before blocking cleaned up friendships: the filter must hold anyway.
    blocks: [
      { blockerId: 'ann', blockedId: 'bob' },
      { blockerId: 'cat', blockedId: 'ann' },
    ],
  });
  assert.deepEqual(await loadFriendIds('ann', db), ['dan']);
  assert.deepEqual(await loadFriendIds('cat', db), []);
  assert.deepEqual(await loadFriendIds('dan', db), ['ann']);
});

test('reactions of a blocked person (either direction) are not shown', () => {
  const reactions = [
    { id: 'r1', userId: 'bob', emoji: '🔥' },
    { id: 'r2', userId: 'dan', emoji: '👍' },
    { id: 'r3', userId: 'cat', emoji: '💩' },
  ];
  assert.deepEqual(
    visibleReactions(reactions, new Set(['bob', 'cat'])).map((r) => r.id),
    ['r2'],
  );
  assert.deepEqual(visibleReactions(reactions, new Set()).map((r) => r.id), ['r1', 'r2', 'r3']);
});
