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
