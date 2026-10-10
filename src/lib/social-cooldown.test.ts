import test from 'node:test';
import assert from 'node:assert/strict';
import { SOCIAL_RETRY_COOLDOWN_DAYS, cooldownRetryDays } from './groups';

const declinedAt = new Date('2026-10-01T12:00:00.000Z');
const after = (hours: number) => new Date(declinedAt.getTime() + hours * 3600 * 1000);

test('a repeat request after a refusal waits 7 days', () => {
  assert.equal(SOCIAL_RETRY_COOLDOWN_DAYS, 7);
  assert.equal(cooldownRetryDays(declinedAt, after(1)), 7);
  assert.equal(cooldownRetryDays(declinedAt, after(24 * 6 + 23)), 1);
  assert.equal(cooldownRetryDays(declinedAt, after(24 * 7)), 0);
  assert.equal(cooldownRetryDays(declinedAt, after(24 * 30)), 0);
});

test('no refusal on record means no wait', () => {
  assert.equal(cooldownRetryDays(null, after(1)), 0);
  assert.equal(cooldownRetryDays(undefined, after(1)), 0);
});

test('cancel-and-resend of a friend request notifies the target at most once per 7 days', async () => {
  const { friendRequestNotifyKey, shouldNotifyFriendRequest } = await import('./groups');
  assert.equal(shouldNotifyFriendRequest(null, after(0)), true); // first request
  assert.equal(shouldNotifyFriendRequest(declinedAt, after(1)), false); // A cancels and re-sends an hour later
  assert.equal(shouldNotifyFriendRequest(declinedAt, after(24 * 6 + 23)), false);
  assert.equal(shouldNotifyFriendRequest(declinedAt, after(24 * 7)), true);
  assert.notEqual(friendRequestNotifyKey('a', 'b'), friendRequestNotifyKey('b', 'a'));
  assert.equal(friendRequestNotifyKey('a', 'b'), friendRequestNotifyKey('a', 'b'));
});

/** The NotificationDispatch table as the friends route's transaction sees it. */
function dispatchTable() {
  const rows = new Map<string, Date>();
  return {
    rows,
    notificationDispatch: {
      findUnique: async ({ where }: { where: { key: string } }) => (rows.has(where.key) ? { createdAt: rows.get(where.key)! } : null),
      upsert: async ({ where, update }: { where: { key: string }; update: { createdAt: Date }; create: { key: string; createdAt: Date } }) => {
        rows.set(where.key, update.createdAt);
        return {};
      },
    },
  };
}

test('request → cancel → request → cancel → request within 7 days wakes the target once; a week later — again', async () => {
  const { claimFriendRequestNotification } = await import('./groups');
  const db = dispatchTable();
  const sent: number[] = [];
  // Every POST /api/friends that creates a request asks this; DELETE (cancel) leaves the dispatch row alone.
  const request = async (hours: number) => {
    if (await claimFriendRequestNotification(db, 'a', 'b', after(hours))) sent.push(hours);
  };

  await request(0);
  await request(1);
  await request(30);
  assert.deepEqual(sent, [0]);

  await request(24 * 7);
  assert.deepEqual(sent, [0, 24 * 7]);
  // the other direction is its own pair
  assert.equal(await claimFriendRequestNotification(db, 'b', 'a', after(24 * 7 + 1)), true);
});
