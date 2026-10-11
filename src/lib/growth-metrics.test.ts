import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGrowthReport, ratePercent } from './growth-metrics';

const TZ = 'Europe/Moscow';
const now = new Date('2026-10-11T12:00:00Z'); // Sunday in Moscow
const d = (iso: string) => new Date(iso);

const users = [
  { id: 'a', createdAt: d('2026-08-01T09:00:00Z'), signupSource: null, referredById: null },
  { id: 'b', createdAt: d('2026-10-01T09:00:00Z'), signupSource: 'invite', referredById: 'a' },
  { id: 'c', createdAt: d('2026-10-09T09:00:00Z'), signupSource: 'utm:telegram', referredById: null },
  { id: 'e', createdAt: d('2026-10-11T08:00:00Z'), signupSource: 'direct', referredById: null },
];
const workouts = [
  // a: active week 1 (Aug 3) and week 4 (Aug 25), and recently
  { userId: 'a', time: d('2026-08-03T10:00:00Z') },
  { userId: 'a', time: d('2026-08-25T10:00:00Z') },
  { userId: 'a', time: d('2026-10-10T10:00:00Z') },
  // b: first workout 2 hours after signup, nothing after day 0
  { userId: 'b', time: d('2026-10-01T11:00:00Z') },
  // c: first workout on day 2 (outside 24h)
  { userId: 'c', time: d('2026-10-11T07:00:00Z') },
];

test('totals: activated, WAU/MAU, referrals', () => {
  const r = buildGrowthReport(users, workouts, now, TZ);
  assert.deepEqual(r.totals, { users: 4, activated: 3, wau: 2, mau: 3, referred: 1, inviters: 1 });
});

test('activation within 24h and 7d only counts users old enough', () => {
  const r = buildGrowthReport(users, workouts, now, TZ);
  // 24h: a (no, first after 2 days), b (yes), c (no) — e is younger than a day
  assert.deepEqual(r.activation.within24h, { hit: 1, of: 3 });
  // 7d: a (yes, day 2), b (yes) — c and e are younger than 7 days
  assert.deepEqual(r.activation.within7d, { hit: 2, of: 2 });
});

test('retention week1 / week4 by calendar day offsets', () => {
  const r = buildGrowthReport(users, workouts, now, TZ);
  assert.deepEqual(r.retention.week1, { hit: 1, of: 2 }); // a yes (day 2), b no
  assert.deepEqual(r.retention.week4, { hit: 1, of: 1 }); // a: Aug 25 = day 24
  assert.equal(ratePercent(r.retention.week1), 50);
  assert.equal(ratePercent({ hit: 0, of: 0 }), null);
});

test('signups by Monday-week and sources', () => {
  const r = buildGrowthReport(users, workouts, now, TZ, 3);
  assert.deepEqual(
    r.signupsByWeek.map((w) => [w.week, w.signups, w.referred]),
    [['2026-09-21', 0, 0], ['2026-09-28', 1, 1], ['2026-10-05', 2, 0]],
  );
  assert.deepEqual(r.sources.map((s) => s.source).sort(), ['direct', 'invite', 'unknown', 'utm:telegram']);
});
