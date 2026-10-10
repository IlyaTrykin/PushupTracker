import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRateLimitWindow, clientIp, tooManyRequests, type RateLimitBucketState } from './rate-limit';

const WINDOW = 15 * 60; // seconds
const start = new Date('2026-10-09T12:00:00.000Z');
const at = (seconds: number) => new Date(start.getTime() + seconds * 1000);

test('the 11th attempt inside the window is rejected', () => {
  let bucket: RateLimitBucketState | null = null;
  const results = [];
  for (let i = 0; i < 11; i += 1) {
    const step = applyRateLimitWindow(bucket, at(i * 10), 10, WINDOW);
    bucket = step.bucket;
    results.push(step);
  }
  assert.deepEqual(results.slice(0, 10).map((r) => r.ok), Array(10).fill(true));
  assert.equal(results[10].ok, false);
  // Window started at +0 s, the 11th attempt is at +100 s → 800 s left.
  assert.equal(results[10].retryAfterSeconds, 800);
  assert.equal(bucket?.count, 11);
  assert.equal(bucket?.windowStart.toISOString(), start.toISOString());
});

test('a new window starts once the previous one is over', () => {
  const full: RateLimitBucketState = { windowStart: start, count: 50 };
  const inside = applyRateLimitWindow(full, at(WINDOW - 1), 10, WINDOW);
  assert.equal(inside.ok, false);
  assert.equal(inside.retryAfterSeconds, 1);

  const after = applyRateLimitWindow(full, at(WINDOW), 10, WINDOW);
  assert.equal(after.ok, true);
  assert.equal(after.retryAfterSeconds, 0);
  assert.deepEqual(after.bucket, { windowStart: at(WINDOW), count: 1 });
});

test('clientIp takes the last X-Forwarded-For address, ignoring forged leading ones', () => {
  const req = (headers: Record<string, string>) => new Request('http://localhost/api/login', { headers });
  assert.equal(clientIp(req({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' })), '203.0.113.7');
  const ips = new Set(Array.from({ length: 30 }, (_, i) => clientIp(req({ 'x-forwarded-for': `198.51.100.${i}, 203.0.113.7` }))));
  assert.deepEqual([...ips], ['203.0.113.7']);
  assert.equal(clientIp(req({ 'x-forwarded-for': ' 2001:db8::1 ' })), '2001:db8::1');
  assert.equal(clientIp(req({ 'x-forwarded-for': '' })), 'unknown');
  assert.equal(clientIp(req({})), 'unknown');
});

test('tooManyRequests answers 429 with Retry-After and minutes in the text', async () => {
  const ru = tooManyRequests(125);
  assert.equal(ru.status, 429);
  assert.equal(ru.headers.get('Retry-After'), '125');
  const ruBody = await ru.json();
  assert.equal(ruBody.error, 'Слишком много попыток, попробуйте через 3 мин');
  assert.equal(ruBody.code, 'RATE_LIMITED');

  const en = tooManyRequests(5, 'en');
  assert.equal(en.headers.get('Retry-After'), '5');
  assert.equal((await en.json()).error, 'Too many attempts, try again in 1 min');
});
