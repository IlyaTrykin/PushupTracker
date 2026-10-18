import test from 'node:test';
import assert from 'node:assert/strict';
import type { BlockPair, BlockReadDb, BlockWhere } from './blocks';
import {
  canReactToWorkout,
  loadFeedUserIds,
  loadFriendList,
  prepareInviteAnswer,
  resolveChallengeInvitees,
  type ChallengeInviteesDb,
  type FeedUsersDb,
  type FriendListDb,
  type InviteAnswerDb,
  type InviteParticipant,
  type ReactionAccessDb,
} from './blocked-access';
import { GroupError, findJoinableInviteGroup, findResolvableJoinRequest, type JoinInviteDb, type JoinRequestDb } from './groups';

// Every server-side refusal and filter for blocked users (R33.1) the API routes rely on:
// a block either way (ann blocked bob, cat blocked ann) must count.

const BLOCKS: BlockPair[] = [
  { blockerId: 'ann', blockedId: 'bob' },
  { blockerId: 'cat', blockedId: 'ann' },
];

type IdFilter = string | { in: string[] } | undefined;
const idMatches = (value: string, filter: IdFilter) =>
  filter === undefined || (typeof filter === 'string' ? value === filter : filter.in.includes(value));

/** `userBlock.findMany` with Prisma's semantics for the `OR` that `blocks.ts` builds. */
function blockTable(rows: BlockPair[] = BLOCKS): BlockReadDb {
  return {
    userBlock: {
      async findMany(args: { where: BlockWhere }) {
        return rows.filter((row) =>
          args.where.OR.some((cond) => idMatches(row.blockerId, cond.blockerId) && idMatches(row.blockedId, cond.blockedId)),
        );
      },
    },
  };
}

const user = (id: string, deletedAt: Date | null = null) => ({ id, username: id, avatarPath: null, deletedAt });
const SINCE = new Date('2026-10-01T00:00:00.000Z');

test('friend list leaves out a friend I blocked and a friend who blocked me', async () => {
  const friendships = [
    { id: 'f1', userId: 'ann', createdAt: SINCE, user: user('ann'), friend: user('bob') },
    { id: 'f2', userId: 'cat', createdAt: SINCE, user: user('cat'), friend: user('ann') },
    { id: 'f3', userId: 'dan', createdAt: SINCE, user: user('dan'), friend: user('ann') },
    { id: 'f4', userId: 'ann', createdAt: SINCE, user: user('ann'), friend: user('old', new Date('2026-01-01')) },
  ];
  const db: FriendListDb = {
    ...blockTable(),
    friendship: { findMany: async () => friendships },
    friendFollow: { findMany: async () => [{ friendId: 'dan' }] },
    friendComparisonHide: { findMany: async () => [] },
  };
  const list = await loadFriendList(db, 'ann');
  assert.deepEqual(
    list.map((row) => [row.userId, row.isFollowing]),
    [['dan', true]],
  );

  // Only blocked friends: an empty list.
  const onlyBlocked = { ...db, friendship: { findMany: async () => friendships.slice(0, 2) } };
  assert.deepEqual(await loadFriendList(onlyBlocked, 'ann'), []);
});

test('feed and comparison show my workouts and friends’ ones, nobody blocked either way', async () => {
  const db: FeedUsersDb = {
    ...blockTable(),
    friendship: {
      findMany: async () => [
        { userId: 'ann', friendId: 'bob' },
        { userId: 'cat', friendId: 'ann' },
        { userId: 'ann', friendId: 'dan' },
      ],
    },
  };
  assert.deepEqual((await loadFeedUserIds(db, 'ann')).sort(), ['ann', 'dan']);
  // Bob's own feed has no ann either.
  const bobs: FeedUsersDb = { ...blockTable(), friendship: { findMany: async () => [{ userId: 'ann', friendId: 'bob' }] } };
  assert.deepEqual(await loadFeedUserIds(bobs, 'bob'), ['bob']);
});

function inviteesDb(): ChallengeInviteesDb {
  const friendsOfAnn = ['bob', 'cat', 'dan'].map((id) => ({ userId: 'ann', user: user('ann'), friend: user(id) }));
  return { ...blockTable(), friendship: { findMany: async () => friendsOfAnn } };
}

test('a challenge cannot invite anyone blocked in either direction', async () => {
  const ann = { id: 'ann', username: 'ann' };
  for (const blocked of ['bob', 'cat']) {
    const result = await resolveChallengeInvitees(inviteesDb(), ann, ['dan', blocked]);
    assert.deepEqual(result, { ok: false, status: 403, error: 'Пригласить этого пользователя нельзя', code: 'USER_BLOCKED' });
  }
  assert.deepEqual(await resolveChallengeInvitees(inviteesDb(), ann, ['dan']), { ok: true, invitedIds: ['dan'] });
  // Not a friend: refused as before, the block check comes after.
  const stranger = await resolveChallengeInvitees(inviteesDb(), ann, ['eve']);
  assert.equal(stranger.ok === false && stranger.code, 'CHALLENGE_NOT_FRIENDS');
});

function inviteDb(creatorId: string, status = 'pending'): InviteAnswerDb {
  const participant: InviteParticipant = { id: 'p1', status, challenge: { groupId: null, creatorId, name: 'Октябрь' } };
  return { ...blockTable(), challengeParticipant: { findFirst: async () => participant } };
}

test('an invitation from someone blocked in either direction cannot be accepted; declining stays possible', async () => {
  for (const creatorId of ['bob', 'cat']) {
    const accept = await prepareInviteAnswer(inviteDb(creatorId), 'c1', 'ann', 'accepted');
    assert.equal(accept.kind, 'respond');
    assert.equal(accept.kind === 'respond' && accept.status, 403);
    assert.equal(accept.kind === 'respond' && accept.body.code, 'USER_BLOCKED');
    const decline = await prepareInviteAnswer(inviteDb(creatorId), 'c1', 'ann', 'declined');
    assert.equal(decline.kind, 'proceed');
  }
  const fromFriend = await prepareInviteAnswer(inviteDb('dan'), 'c1', 'ann', 'accepted');
  assert.equal(fromFriend.kind === 'proceed' && fromFriend.participant.id, 'p1');
});

function reactionDb(): ReactionAccessDb {
  // Everyone is ann's friend: only the block keeps bob and cat out.
  return {
    ...blockTable(),
    friendship: { findFirst: async () => ({ id: 'f' }) },
    groupMembership: { findFirst: async () => ({ id: 'm' }) },
  };
}

test('nobody reacts to a workout of someone blocked in either direction, even a friend or group mate', async () => {
  assert.equal(await canReactToWorkout(reactionDb(), 'ann', 'bob'), false);
  assert.equal(await canReactToWorkout(reactionDb(), 'bob', 'ann'), false);
  assert.equal(await canReactToWorkout(reactionDb(), 'ann', 'cat'), false);
  assert.equal(await canReactToWorkout(reactionDb(), 'ann', 'dan'), true);
  assert.equal(await canReactToWorkout(reactionDb(), 'ann', 'ann'), true);
  const strangers: ReactionAccessDb = { ...blockTable(), friendship: { findFirst: async () => null }, groupMembership: { findFirst: async () => null } };
  assert.equal(await canReactToWorkout(strangers, 'ann', 'dan'), false);
});

const isUserBlocked = (e: unknown) => e instanceof GroupError && e.status === 403 && e.code === 'USER_BLOCKED';

function inviteLinkDb(ownerId: string): JoinInviteDb {
  const now = new Date('2026-10-01T00:00:00.000Z');
  const group = { id: 'g1', name: 'Утро', ownerId, deletedAt: null, createdAt: now, updatedAt: now, owner: { id: ownerId, username: ownerId, avatarPath: null } };
  return { ...blockTable(), groupInviteLink: { findUnique: async () => ({ token: 't', group }) } };
}

test('no join request to a group whose owner blocked me or whom I blocked', async () => {
  await assert.rejects(findJoinableInviteGroup(inviteLinkDb('ann'), 'bob', 't'), isUserBlocked);
  await assert.rejects(findJoinableInviteGroup(inviteLinkDb('cat'), 'ann', 't'), isUserBlocked);
  await assert.rejects(findJoinableInviteGroup(inviteLinkDb('bob'), 'ann', 't'), isUserBlocked);
  assert.equal((await findJoinableInviteGroup(inviteLinkDb('dan'), 'ann', 't')).id, 'g1');
});

function joinRequestDb(userId: string): JoinRequestDb {
  const request = { id: 'r1', groupId: 'g1', userId, status: 'pending', user: { id: userId, username: userId, avatarPath: null } };
  return { ...blockTable(), groupJoinRequest: { findFirst: async () => request } };
}

test('the owner cannot approve a join request of someone blocked in either direction, only reject it', async () => {
  const annsGroup = { id: 'g1', ownerId: 'ann' };
  await assert.rejects(findResolvableJoinRequest(joinRequestDb('bob'), annsGroup, 'r1', 'approve'), isUserBlocked);
  await assert.rejects(findResolvableJoinRequest(joinRequestDb('cat'), annsGroup, 'r1', 'approve'), isUserBlocked);
  assert.equal((await findResolvableJoinRequest(joinRequestDb('bob'), annsGroup, 'r1', 'reject')).id, 'r1');
  assert.equal((await findResolvableJoinRequest(joinRequestDb('dan'), annsGroup, 'r1', 'approve')).id, 'r1');
});
