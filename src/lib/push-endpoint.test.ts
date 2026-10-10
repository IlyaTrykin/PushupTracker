import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PUSH_SUBSCRIPTIONS_PER_USER,
  isAllowedPushEndpoint,
  isValidPushKey,
  subscriptionsToEvict,
} from './push-endpoint';
import { deliverToSubscriptions, type StoredPushSubscription } from './web-push';

test('real push-service endpoints are accepted', () => {
  const endpoints = [
    'https://fcm.googleapis.com/fcm/send/dQw4w9WgXcQ:APA91bHPRgkF',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABk',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
    'https://web.push.apple.com/QGuQyavXutnMH9hw',
  ];
  for (const endpoint of endpoints) assert.equal(isAllowedPushEndpoint(endpoint), true, endpoint);
});

test('internal hosts, plain http and look-alike domains are rejected', () => {
  const endpoints = [
    'https://pushup-db:5432/',
    'https://127.0.0.1/fcm/send/x',
    'https://169.254.169.254/latest/meta-data',
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.example/fcm/send/x',
    'https://evilfcm.googleapis.com.example/x',
    'https://notify.windows.com.evil.example/x',
    'https://evilpush.services.mozilla.com/x',
    'https://fcm.googleapis.com:8443/fcm/send/x',
    'https://user:pass@fcm.googleapis.com/fcm/send/x',
    'javascript:alert(1)',
    '',
    `https://fcm.googleapis.com/fcm/send/${'a'.repeat(3000)}`,
  ];
  for (const endpoint of endpoints) assert.equal(isAllowedPushEndpoint(endpoint), false, endpoint);
  assert.equal(isAllowedPushEndpoint(null), false);
  assert.equal(isAllowedPushEndpoint(42), false);
});

test('push keys must be short base64url strings', () => {
  assert.equal(isValidPushKey('BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM'), true);
  assert.equal(isValidPushKey('tBHItJI5svbpez7KI4CCXg=='), true);
  assert.equal(isValidPushKey(''), false);
  assert.equal(isValidPushKey('<script>'), false);
  assert.equal(isValidPushKey('a'.repeat(300)), false);
});

test('the oldest subscriptions are evicted above the per-user limit', () => {
  assert.equal(MAX_PUSH_SUBSCRIPTIONS_PER_USER, 10);
  const subs = Array.from({ length: 12 }, (_, i) => ({
    id: `s${i}`,
    updatedAt: new Date(Date.UTC(2026, 9, 1 + i)),
  }));
  // shuffled order must not matter
  const shuffled = [subs[5], subs[0], subs[11], subs[1], ...subs.filter((_, i) => ![0, 1, 5, 11].includes(i))];
  assert.deepEqual(subscriptionsToEvict(shuffled).sort(), ['s0', 's1']);
  assert.deepEqual(subscriptionsToEvict(subs.slice(0, 10)), []);
});

test('sending skips and removes subscriptions whose endpoint is not a push service', async () => {
  const sub = (id: string, endpoint: string): StoredPushSubscription => ({ id, endpoint, p256dh: 'key', auth: 'auth' });
  const subscriptions = [
    sub('good', 'https://fcm.googleapis.com/fcm/send/abc'),
    sub('internal', 'https://169.254.169.254/latest/meta-data'),
    sub('plain-http', 'http://fcm.googleapis.com/fcm/send/abc'),
    sub('gone', 'https://updates.push.services.mozilla.com/wpush/v2/x'),
  ];
  const sentTo: string[] = [];
  const removed: string[] = [];
  await deliverToSubscriptions(subscriptions, '{}', {
    async send(s) {
      sentTo.push(s.id);
      if (s.id === 'gone') throw Object.assign(new Error('Gone'), { statusCode: 410 });
    },
    async removeSubscriptions(ids) {
      removed.push(...ids);
    },
  });
  assert.deepEqual(sentTo.sort(), ['gone', 'good']);
  assert.deepEqual(removed.sort(), ['gone', 'internal', 'plain-http']);
});
