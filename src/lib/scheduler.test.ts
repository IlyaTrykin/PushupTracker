import test from 'node:test';
import assert from 'node:assert/strict';
import { registerJob, runSchedulerTick, clearJobsForTest } from './scheduler/index';
import {
  createProgramRemindersJob,
  planMissedSessionNotices,
  reminderWindow,
  type ProgramRemindersDeps,
} from './scheduler/jobs/program-reminders';
import { cleanupCutoffs, createCleanupJob, type CleanupDeps } from './scheduler/jobs/cleanup';
import type { LocalizedMessage, NotifyEvent, NotifyLocale, NotifyOptions } from './notify';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function uniqueClaims() {
  const keys = new Set<string>();
  return {
    keys,
    claim: async (key: string) => {
      if (keys.has(key)) return false;
      keys.add(key);
      return true;
    },
  };
}

type NotifyCall = { userIds: string[]; event: NotifyEvent; opts?: NotifyOptions; ru: LocalizedMessage; en: LocalizedMessage };

function recordingNotify(calls: NotifyCall[]) {
  return async (
    userIds: string[],
    event: NotifyEvent,
    build: (locale: NotifyLocale, userId: string) => LocalizedMessage,
    opts?: NotifyOptions,
  ) => {
    calls.push({ userIds, event, opts, ru: build('ru', userIds[0]), en: build('en', userIds[0]) });
  };
}

test('a tick runs every job with the same now; one failing job does not stop the others', async () => {
  clearJobsForTest();
  const seen: string[] = [];
  const now = new Date('2026-10-10T16:00:00.000Z');
  registerJob({ name: 'broken', run: async () => { throw new Error('boom'); } });
  registerJob({ name: 'ok', run: async (at) => { seen.push(at.toISOString()); } });

  await runSchedulerTick(now);

  assert.deepEqual(seen, ['2026-10-10T16:00:00.000Z']);
  clearJobsForTest();
});

test('reminder window is 15 min back and 30 min ahead of now', () => {
  const now = new Date('2026-10-10T15:50:00.000Z');
  const { from, to } = reminderWindow(now);
  assert.equal(from.toISOString(), '2026-10-10T15:35:00.000Z');
  assert.equal(to.toISOString(), '2026-10-10T16:20:00.000Z');
});

function programDeps(overrides: Partial<ProgramRemindersDeps>, calls: NotifyCall[], claims = uniqueClaims()): ProgramRemindersDeps {
  return {
    findDueSessions: async () => [],
    findOverdueSessions: async () => [],
    hasLegacyNotice: async () => false,
    markReminderSent: async () => {},
    claimDispatch: claims.claim,
    notifyUsers: recordingNotify(calls),
    ...overrides,
  };
}

test('B33: two parallel program-reminder ticks send one reminder per session (key program-reminder:<sessionId>)', async () => {
  const calls: NotifyCall[] = [];
  const claims = uniqueClaims();
  const scheduledAt = new Date('2026-10-10T16:00:00.000Z');
  const job = createProgramRemindersJob(programDeps({
    findDueSessions: async () => [{ id: 's1', userId: 'u1', exerciseType: 'pushups', scheduledAt }],
  }, calls, claims));
  const now = new Date('2026-10-10T15:50:00.000Z');

  await Promise.all([job.run(now), job.run(now)]);

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].userIds, ['u1']);
  assert.equal(calls[0].event, 'program_reminder');
  assert.ok(claims.keys.has('program-reminder:s1'));
  assert.equal(calls[0].ru.link, '/program/session/s1');
});

test('reminder text is in the recipient language with the catalog exercise name', async () => {
  const calls: NotifyCall[] = [];
  const job = createProgramRemindersJob(programDeps({
    findDueSessions: async () => [{ id: 's1', userId: 'u1', exerciseType: 'pushups', scheduledAt: new Date('2026-10-10T16:00:00.000Z') }],
  }, calls));

  await job.run(new Date('2026-10-10T15:50:00.000Z'));

  assert.match(calls[0].en.body ?? '', /push-ups/i);
  assert.match(calls[0].en.body ?? '', /10 min/);
  assert.match(calls[0].ru.body ?? '', /отжимания/i);
  assert.doesNotMatch(`${calls[0].en.title} ${calls[0].en.body}`, /pushups|[А-Яа-яЁё]/);
});

test('missed-session notices: 1 h, 24 h and the stop warning each have their own window and key', () => {
  const scheduledAt = new Date('2026-10-09T16:00:00.000Z'); // 19:00 Moscow
  const base = { id: 's1', scheduledAt, shiftedCount: 0, timeZone: 'Europe/Moscow' };

  assert.deepEqual(planMissedSessionNotices(base, new Date(scheduledAt.getTime() + 30 * 60 * 1000)), []);
  assert.deepEqual(
    planMissedSessionNotices(base, new Date(scheduledAt.getTime() + 2 * HOUR)).map((n) => n.key),
    ['program-missed-1h:s1:2026-10-09T16:00:00.000Z'],
  );
  assert.deepEqual(
    planMissedSessionNotices(base, new Date(scheduledAt.getTime() + 25 * HOUR)).map((n) => n.kind),
    ['missed_24h'],
  );
  // long-stale sessions do not get a late «1 hour ago» or «a day ago» notice
  assert.deepEqual(planMissedSessionNotices(base, new Date(scheduledAt.getTime() + 3 * DAY)), []);
  // 6 days carried by earlier shifts + 1 overdue day = 7 → warning, keyed by session
  const warned = planMissedSessionNotices({ ...base, shiftedCount: 6 }, new Date(scheduledAt.getTime() + 25 * HOUR));
  assert.deepEqual(warned.map((n) => n.key), ['program-missed-24h:s1:2026-10-09T16:00:00.000Z', 'program-stop-warning:s1']);
});

test('missed notices are claimed once and keep their legacy Notification.type', async () => {
  const calls: NotifyCall[] = [];
  const claims = uniqueClaims();
  const scheduledAt = new Date('2026-10-09T16:00:00.000Z');
  const job = createProgramRemindersJob(programDeps({
    findOverdueSessions: async () => [
      { id: 's1', userId: 'u1', programId: 'p1', exerciseType: 'squats', scheduledAt, shiftedCount: 0, timeZone: 'Europe/Moscow' },
    ],
  }, calls, claims));
  const now = new Date(scheduledAt.getTime() + 2 * HOUR);

  await job.run(now);
  await job.run(now);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts?.type, 'program_missed_1h');
  assert.match(calls[0].en.body ?? '', /squats/i);
});

test('a missed notice already written by the old page-load code is not sent again', async () => {
  const calls: NotifyCall[] = [];
  const scheduledAt = new Date('2026-10-09T16:00:00.000Z');
  const job = createProgramRemindersJob(programDeps({
    findOverdueSessions: async () => [
      { id: 's1', userId: 'u1', programId: 'p1', exerciseType: 'squats', scheduledAt, shiftedCount: 0, timeZone: 'Europe/Moscow' },
    ],
    hasLegacyNotice: async (_userId, type) => type === 'program_missed_1h',
  }, calls));

  await job.run(new Date(scheduledAt.getTime() + 2 * HOUR));

  assert.equal(calls.length, 0);
});

test('cleanup cut-offs: expired now, rate-limit buckets older than a day, notifications 180 days, dispatch keys 60 days', () => {
  const now = new Date('2026-10-10T03:00:00.000Z');
  const c = cleanupCutoffs(now);
  assert.equal(c.expiredBefore.toISOString(), '2026-10-10T03:00:00.000Z');
  assert.equal(c.rateLimitBefore.toISOString(), '2026-10-09T03:00:00.000Z');
  assert.equal(c.notificationsBefore.toISOString(), '2026-04-13T03:00:00.000Z');
  assert.equal(c.dispatchBefore.toISOString(), '2026-08-11T03:00:00.000Z');
});

test('cleanup runs once per UTC day however many ticks there are', async () => {
  const runs: string[] = [];
  const claims = uniqueClaims();
  const deps: CleanupDeps = {
    claimDispatch: claims.claim,
    deleteOlderThan: async (cutoffs) => {
      runs.push(cutoffs.expiredBefore.toISOString());
      return {};
    },
  };
  const job = createCleanupJob(deps);

  await job.run(new Date('2026-10-10T00:05:00.000Z'));
  await job.run(new Date('2026-10-10T00:10:00.000Z'));
  await job.run(new Date('2026-10-11T00:05:00.000Z'));

  assert.deepEqual(runs, ['2026-10-10T00:05:00.000Z', '2026-10-11T00:05:00.000Z']);
});

test('stop warning: any earlier program_stop_warning with this link counts, even one written before the session was shifted', async () => {
  const calls: NotifyCall[] = [];
  // The session was shifted after the old page-load code had warned: the old notice is older than scheduledAt.
  const scheduledAt = new Date('2026-10-09T16:00:00.000Z');
  const legacy = [{ userId: 'u1', type: 'program_stop_warning', link: '/program/session/s1', createdAt: new Date('2026-10-05T10:00:00.000Z') }];
  const job = createProgramRemindersJob(programDeps({
    findOverdueSessions: async () => [
      { id: 's1', userId: 'u1', programId: 'p1', exerciseType: 'squats', scheduledAt, shiftedCount: 6, timeZone: 'Europe/Moscow' },
    ],
    hasLegacyNotice: async (userId, type, link, since) =>
      legacy.some((n) => n.userId === userId && n.type === type && n.link === link && (since == null || n.createdAt >= since)),
  }, calls));

  await job.run(new Date(scheduledAt.getTime() + 25 * HOUR));

  assert.deepEqual(calls.map((c) => c.opts?.type), ['program_missed_24h']);
});
