import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOutcome,
  backoffSeconds,
  buildQueueEditPatch,
  classifyResponse,
  createOutboxItem,
  editOutboxItem,
  markForServerDelete,
  markSending,
  needsFollowUpEdit,
  nextSendable,
  pendingPoints,
  planQueuedRemoval,
  queueEntryState,
  queueErrorKind,
  resolveEntryMoment,
  unsentNotice,
  toRequestBody,
  type OutboxItem,
  type OutboxPayload,
} from './outbox-core';
import { workoutFingerprint } from '../health/reconcile';

const NOW = new Date('2026-10-17T10:00:00.000Z');

function payload(overrides: Partial<OutboxPayload> = {}): Omit<OutboxPayload, 'clientRequestId'> & { clientRequestId?: string } {
  return { exerciseType: 'pushups', reps: 20, date: '2026-10-17', time: '2026-10-17T09:55:00.000Z', ...overrides };
}

function item(id: string, createdAt: string, overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    ...createOutboxItem('u1', payload({ clientRequestId: id }), new Date(createdAt)),
    ...overrides,
  };
}

function secondsAfter(now: Date, iso: string | null | undefined): number {
  assert.ok(iso, 'expected a timestamp');
  return (new Date(iso).getTime() - now.getTime()) / 1000;
}

// ---------- createOutboxItem ----------

test('a new item keeps the day and time of the entry and is keyed by its clientRequestId', () => {
  const created = createOutboxItem('u1', payload({ clientRequestId: 'req-1' }), NOW);
  assert.equal(created.id, 'req-1');
  assert.equal(created.payload.clientRequestId, 'req-1');
  assert.equal(created.userId, 'u1');
  assert.equal(created.payload.date, '2026-10-17');
  assert.equal(created.payload.time, '2026-10-17T09:55:00.000Z');
  assert.equal(created.status, 'pending');
  assert.equal(created.attempts, 0);
  assert.equal(created.createdAt, NOW.toISOString());
  assert.equal(created.nextAttemptAt, null);
  assert.equal(created.lastError, null);
});

test('without a given id the item gets a fresh one the server accepts', () => {
  const a = createOutboxItem('u1', payload(), NOW);
  const b = createOutboxItem('u1', payload(), NOW);
  assert.notEqual(a.id, b.id);
  for (const created of [a, b]) {
    assert.equal(created.id, created.payload.clientRequestId);
    assert.match(created.id, /^[A-Za-z0-9_.:-]{1,64}$/);
  }
});

// ---------- nextSendable ----------

test('items go out in the order they were recorded', () => {
  const first = item('a', '2026-10-17T08:00:00.000Z');
  const second = item('b', '2026-10-17T08:05:00.000Z');
  const third = item('c', '2026-10-17T08:10:00.000Z');
  assert.equal(nextSendable([third, first, second], NOW)?.id, 'a');
  assert.equal(nextSendable([third, second], NOW)?.id, 'b');
  assert.equal(nextSendable([], NOW), null);
});

test('rejected items wait for the user and do not hold back the rest', () => {
  const rejected = item('a', '2026-10-17T08:00:00.000Z', { status: 'rejected', lastError: 'bad' });
  const next = item('b', '2026-10-17T08:05:00.000Z');
  assert.equal(nextSendable([rejected, next], NOW)?.id, 'b');
  assert.equal(nextSendable([rejected], NOW), null);
});

test('an item waiting out its pause holds back later ones, unless the pause is skipped', () => {
  const waiting = item('a', '2026-10-17T08:00:00.000Z', { attempts: 2, nextAttemptAt: '2026-10-17T10:00:10.000Z' });
  const later = item('b', '2026-10-17T08:05:00.000Z');
  assert.equal(nextSendable([waiting, later], NOW), null);
  assert.equal(nextSendable([waiting, later], new Date('2026-10-17T10:00:10.000Z'))?.id, 'a');
  assert.equal(nextSendable([waiting, later], NOW, { ignoreBackoff: true })?.id, 'a');
});

test('an item being sent is not picked again until its lease runs out', () => {
  const sending = markSending(item('a', '2026-10-17T08:00:00.000Z'), NOW);
  const later = item('b', '2026-10-17T08:05:00.000Z');
  assert.equal(sending.status, 'sending');
  assert.equal(nextSendable([sending, later], NOW), null);
  assert.equal(nextSendable([sending, later], NOW, { ignoreBackoff: true }), null);
  // The tab that was sending died: after the lease the item is sent again (same clientRequestId).
  assert.equal(nextSendable([sending, later], new Date(NOW.getTime() + 10 * 60_000))?.id, 'a');
});

// ---------- applyOutcome ----------

test('created and replayed answers remove the item', () => {
  const sending = markSending(item('a', '2026-10-17T08:00:00.000Z'), NOW);
  assert.deepEqual(applyOutcome(sending, { kind: 'created', workoutId: 'w1' }, NOW), { item: null });
  assert.deepEqual(applyOutcome(sending, { kind: 'replayed', workoutId: 'w1' }, NOW), { item: null });
});

test('a refusal keeps the item as rejected with the server text', () => {
  const sending = markSending(item('a', '2026-10-17T08:00:00.000Z'), NOW);
  const result = applyOutcome(sending, { kind: 'rejected', status: 400, message: 'Некорректная дата' }, NOW);
  assert.ok(result.item);
  assert.equal(result.item.status, 'rejected');
  assert.equal(result.item.lastError, 'Некорректная дата');
  assert.equal(result.item.id, 'a');
  assert.equal(result.stop, undefined);
});

test('429 pauses the queue until Retry-After without spending an attempt', () => {
  const sending = markSending(item('a', '2026-10-17T08:00:00.000Z', { attempts: 1 }), NOW);
  const result = applyOutcome(sending, { kind: 'rate-limited', retryAfterSeconds: 120 }, NOW);
  assert.ok(result.item);
  assert.equal(result.item.status, 'pending');
  assert.equal(result.item.attempts, 1);
  assert.equal(secondsAfter(NOW, result.pauseUntil), 120);
  assert.equal(secondsAfter(NOW, result.item.nextAttemptAt), 120);
});

test('401 keeps the item untouched and stops until the user signs in', () => {
  const sending = markSending(item('a', '2026-10-17T08:00:00.000Z'), NOW);
  const result = applyOutcome(sending, { kind: 'unauthorized' }, NOW);
  assert.equal(result.stop, 'unauthorized');
  assert.ok(result.item);
  assert.equal(result.item.status, 'pending');
  assert.equal(result.item.nextAttemptAt, null);
  assert.equal(result.item.payload.clientRequestId, 'a');
});

test('a network failure or 5xx retries with a growing pause', () => {
  let current = item('a', '2026-10-17T08:00:00.000Z');
  const pauses: number[] = [];
  for (let i = 0; i < 6; i += 1) {
    const result = applyOutcome(markSending(current, NOW), { kind: 'retry', reason: 'network' }, NOW);
    assert.ok(result.item);
    assert.equal(result.item.status, 'pending');
    assert.equal(result.item.lastError, 'network');
    pauses.push(secondsAfter(NOW, result.item.nextAttemptAt));
    current = result.item;
  }
  assert.deepEqual(pauses, [5, 15, 60, 300, 900, 900]);
  assert.equal(current.attempts, 6);
  assert.equal(current.payload.clientRequestId, 'a');
});

test('backoff steps are 5, 15, 60, 300 seconds, then 900', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 50].map(backoffSeconds), [5, 15, 60, 300, 900, 900, 900]);
});

// ---------- editing ----------

test('editing an unsent item changes its payload and sends it again from scratch', () => {
  const rejected = item('a', '2026-10-17T08:00:00.000Z', { status: 'rejected', attempts: 1, lastError: 'bad' });
  const edited = editOutboxItem(rejected, { reps: 25, date: '2026-10-16' }, NOW);
  assert.ok(edited);
  assert.equal(edited.payload.reps, 25);
  assert.equal(edited.payload.date, '2026-10-16');
  assert.equal(edited.payload.exerciseType, 'pushups');
  assert.equal(edited.payload.clientRequestId, 'a');
  assert.equal(edited.id, 'a');
  assert.equal(edited.status, 'pending');
  assert.equal(edited.attempts, 0);
  assert.equal(edited.lastError, null);
  assert.equal(edited.nextAttemptAt, null);
});

test('an item that is being sent cannot be edited', () => {
  const sending = markSending(item('a', '2026-10-17T08:00:00.000Z'), NOW);
  assert.equal(editOutboxItem(sending, { reps: 25 }, NOW), null);
});

test('a replayed record that differs from the edited payload needs a follow-up edit', () => {
  const p = { ...payload({ reps: 25 }), clientRequestId: 'a' };
  const same = { id: 'w1', reps: 25, exerciseType: 'pushups', date: '2026-10-17T00:00:00.000Z', time: '2026-10-17T09:55:00.000Z' };
  assert.equal(needsFollowUpEdit(p, same), false);
  assert.equal(needsFollowUpEdit(p, { ...same, reps: 20 }), true);
  assert.equal(needsFollowUpEdit(p, { ...same, date: '2026-10-16T00:00:00.000Z' }), true);
  assert.equal(needsFollowUpEdit(p, { ...same, time: '2026-10-17T09:00:00.000Z' }), true);
  assert.equal(needsFollowUpEdit(p, { ...same, exerciseType: 'squats' }), true);
});

// ---------- points ----------

test('points of the day count unsent items of that day, not rejected ones', () => {
  const items = [
    item('a', '2026-10-17T08:00:00.000Z', { payload: { ...payload({ reps: 20 }), clientRequestId: 'a' } }),
    item('b', '2026-10-17T08:01:00.000Z', { payload: { ...payload({ exerciseType: 'plank', reps: 60 }), clientRequestId: 'b' } }),
    item('c', '2026-10-17T08:02:00.000Z', { payload: { ...payload({ exerciseType: 'run', reps: 1000 }), clientRequestId: 'c' } }),
    item('d', '2026-10-17T08:03:00.000Z', { payload: { ...payload({ exerciseType: 'kettlebell_swing', reps: 20, loadKg: 12 }), clientRequestId: 'd' } }),
    item('e', '2026-10-17T08:04:00.000Z', { payload: { ...payload({ reps: 50, date: '2026-10-16' }), clientRequestId: 'e' } }),
    item('f', '2026-10-17T08:05:00.000Z', { status: 'rejected', payload: { ...payload({ reps: 40 }), clientRequestId: 'f' } }),
  ];
  // 20 push-ups = 20, 60 s plank = 6, 1 km run = 15, 20 swings with 12 kg (reference 24 kg) = 5.
  assert.equal(pendingPoints(items, '2026-10-17'), 46);
  assert.equal(pendingPoints(items, '2026-10-16'), 50);
  assert.equal(pendingPoints(items, '2026-10-15'), 0);
});

// ---------- server answers ----------

test('server answers map to send outcomes', () => {
  assert.deepEqual(classifyResponse(200, { workout: { id: 'w1' } }, null), { kind: 'created', workoutId: 'w1', response: { workout: { id: 'w1' } } });
  assert.deepEqual(classifyResponse(400, { error: 'Некорректная дата', details: 'слишком рано' }, null), {
    kind: 'rejected',
    status: 400,
    message: 'Некорректная дата: слишком рано',
  });
  assert.deepEqual(classifyResponse(413, null, null), { kind: 'rejected', status: 413, message: 'HTTP 413' });
  assert.deepEqual(classifyResponse(401, { error: 'Не авторизован' }, null), { kind: 'unauthorized' });
  assert.deepEqual(classifyResponse(429, { error: 'Слишком много' }, '120'), { kind: 'rate-limited', retryAfterSeconds: 120 });
  assert.deepEqual(classifyResponse(429, null, null), { kind: 'rate-limited', retryAfterSeconds: 60 });
  assert.deepEqual(classifyResponse(500, null, null), { kind: 'retry', reason: 'HTTP 500' });
  assert.deepEqual(classifyResponse(503, null, null), { kind: 'retry', reason: 'HTTP 503' });
  // 2xx without a workout id is not proof the record exists: try again with the same id.
  assert.equal(classifyResponse(200, null, null).kind, 'retry');
});

test('the request body drops empty optional fields and keeps day, time and id', () => {
  const body = toRequestBody({ ...payload({ loadKg: null, repsLeft: undefined, durationSeconds: null }), clientRequestId: 'a' });
  assert.deepEqual(body, { exerciseType: 'pushups', reps: 20, date: '2026-10-17', time: '2026-10-17T09:55:00.000Z', clientRequestId: 'a' });
});

// ---------- day and time of an entry ----------

test('an untouched entry belongs to today in the user zone and to this instant', () => {
  // 21:30 UTC is 00:30 next day in Moscow.
  const now = new Date('2026-10-17T21:30:00.000Z');
  const moment = resolveEntryMoment({ date: '2026-10-17', time: '21:30', dateTouched: false, timeTouched: false }, now, 'Europe/Moscow');
  assert.deepEqual(moment, { date: '2026-10-18', time: '2026-10-17T21:30:00.000Z' });
});

test('a chosen day and time are read on the user wall clock', () => {
  const now = new Date('2026-10-17T21:30:00.000Z');
  assert.deepEqual(
    resolveEntryMoment({ date: '2026-10-16', time: '09:15', dateTouched: true, timeTouched: true }, now, 'Europe/Moscow'),
    { date: '2026-10-16', time: '2026-10-16T06:15:00.000Z' },
  );
  // Only the day changed: the current wall-clock time on that day.
  assert.deepEqual(
    resolveEntryMoment({ date: '2026-10-16', time: '23:59', dateTouched: true, timeTouched: false }, now, 'Europe/Moscow'),
    { date: '2026-10-16', time: '2026-10-15T21:30:00.000Z' },
  );
});

test('RepCounter duration is not queued for rep exercises (the server keeps duration only for distance)', () => {
  const counted = createOutboxItem('u1', payload({ exerciseType: 'pushups', reps: 20, durationSeconds: 40 }), NOW);
  assert.equal(counted.payload.durationSeconds, undefined);
  assert.equal('durationSeconds' in toRequestBody(counted.payload), false);

  const run = createOutboxItem('u1', payload({ exerciseType: 'run', reps: 5000, durationSeconds: 1500 }), NOW);
  assert.equal(run.payload.durationSeconds, 1500);

  const edited = editOutboxItem(counted, { reps: 25, durationSeconds: 50 }, NOW);
  assert.equal(edited?.payload.durationSeconds, undefined);
});

test('the server answer without duration for a counted rep workout needs no follow-up edit', () => {
  // An item queued by an older build still carries the counted duration.
  const old = { ...createOutboxItem('u1', payload({ exerciseType: 'squats', reps: 20 }), NOW).payload, durationSeconds: 40 };
  const server = { id: 'w1', exerciseType: 'squats', reps: 20, date: old.date, time: old.time, loadKg: null, durationSeconds: null };
  assert.equal(needsFollowUpEdit(old, server), false);
  // Distance still compares the duration.
  const run = createOutboxItem('u1', payload({ exerciseType: 'run', reps: 5000, durationSeconds: 1500 }), NOW).payload;
  assert.equal(needsFollowUpEdit(run, { ...server, exerciseType: 'run', reps: 5000, durationSeconds: 1200 }), true);
});

test('Health fingerprint of a counted workout written at once equals the one of the server record (no rewrite on reconcile)', () => {
  const queued = createOutboxItem('u1', payload({ exerciseType: 'pullups', reps: 8, durationSeconds: 30 }), NOW).payload;
  const server = { id: 'w1', clientRequestId: queued.clientRequestId, exerciseType: 'pullups', reps: 8, durationSeconds: null, time: queued.time };
  assert.equal(workoutFingerprint(queued), workoutFingerprint(server));
});

// ---------- delete of an entry that may be on the server (story 50) ----------

test('an entry that never left the device is simply dropped on delete', () => {
  const fresh = item('a', '2026-10-17T09:00:00.000Z');
  assert.equal(planQueuedRemoval(fresh, 'none'), 'drop');
  assert.equal(planQueuedRemoval(fresh, 'cancelled'), 'drop');
});

test('an entry that may be on the server becomes «будет удалена»: it was attempted, taken by a sender, or its native copy went out', () => {
  const fresh = item('a', '2026-10-17T09:00:00.000Z');
  // A network failure: the request may have reached the server before the answer was lost.
  const failedOnce = applyOutcome(markSending(fresh, NOW), { kind: 'retry', reason: 'timeout' }, NOW).item!;
  assert.equal(planQueuedRemoval(failedOnce, 'none'), 'tombstone');
  // An edit restarts the attempts, but the earlier request may still be on the server.
  const editedAfter = editOutboxItem(failedOnce, { reps: 30 }, NOW)!;
  assert.equal(editedAfter.attempts, 0);
  assert.equal(planQueuedRemoval(editedAfter, 'cancelled'), 'tombstone');
  // The native background copy could not be taken back: on the server or on its way.
  assert.equal(planQueuedRemoval(fresh, 'sent'), 'tombstone');
});

test('a tombstone is not counted, is sent as a delete and leaves the queue only on the server’s confirmation', () => {
  const tomb = markForServerDelete(applyOutcome(markSending(item('a', '2026-10-17T09:00:00.000Z'), NOW), { kind: 'retry', reason: 'network' }, NOW).item!);
  assert.equal(tomb.deleteOnServer, true);
  assert.equal(pendingPoints([tomb], '2026-10-17'), 0);
  assert.equal(nextSendable([tomb], NOW)?.id, 'a');
  // No connection: stays a tombstone with the usual pause.
  const offline = applyOutcome(markSending(tomb, NOW), { kind: 'retry', reason: 'network' }, NOW).item!;
  assert.equal(offline.deleteOnServer, true);
  assert.equal(offline.status, 'pending');
  assert.equal(secondsAfter(NOW, offline.nextAttemptAt), 5);
  // A refusal does not turn it into a «not accepted» workout: retried later, reason kept.
  const refused = applyOutcome(markSending(tomb, NOW), { kind: 'rejected', status: 400, message: 'bad' }, NOW).item!;
  assert.equal(refused.deleteOnServer, true);
  assert.equal(refused.status, 'pending');
  assert.equal(refused.lastError, 'bad');
  // Confirmed: gone.
  assert.equal(applyOutcome(markSending(tomb, NOW), { kind: 'deleted' }, NOW).item, null);
  // Edits of a tombstone are refused.
  assert.equal(editOutboxItem(tomb, { reps: 5 }, NOW), null);
});

// ---------- honest queue messages (story 55) ----------

test('a busy queue with a live network says «queued for sending», not «no connection»', () => {
  // Nothing was sent because an older entry waits out its pause or another sender holds it.
  assert.equal(unsentNotice({}, true), 'queued');
  assert.equal(unsentNotice({ stopped: 'offline', retryReason: 'background upload' }, true), 'queued');
  // Really no connection.
  assert.equal(unsentNotice({}, false), 'offline');
  assert.equal(unsentNotice({ stopped: 'offline', retryReason: 'network' }, true), 'offline');
  // The server is there but failed or did not answer in time.
  assert.equal(unsentNotice({ stopped: 'offline', retryReason: 'HTTP 503' }, true), 'server');
  assert.equal(unsentNotice({ stopped: 'offline', retryReason: 'timeout' }, true), 'server');
  assert.equal(unsentNotice({ stopped: 'rate-limited' }, true), 'rate-limited');
  assert.equal(unsentNotice({ stopped: 'unauthorized' }, false), 'unauthorized');
});

test('after 3 failed tries the badge of a waiting entry shows the reason', () => {
  let entry = item('a', '2026-10-17T09:00:00.000Z');
  const reasons: Array<string | null> = [];
  for (const reason of ['network', 'timeout', 'HTTP 503']) {
    entry = applyOutcome(markSending(entry, NOW), { kind: 'retry', reason }, NOW).item!;
    reasons.push(queueEntryState(entry).reason);
  }
  assert.deepEqual(reasons, [null, null, 'HTTP 503']);
  assert.equal(queueEntryState(entry).state, 'pending');
  assert.deepEqual(queueEntryState({ ...entry, status: 'rejected', lastError: 'Некорректное значение' }), { state: 'rejected', reason: 'Некорректное значение' });
  assert.equal(queueEntryState(markForServerDelete(entry)).state, 'deleting');
  assert.deepEqual(['network', 'timeout', 'HTTP 503', 'HTTP 500', 'Запись не найдена'].map(queueErrorKind), ['network', 'timeout', 'server', 'server', 'other']);
});

// ---------- editing a queued entry (story 54) ----------

test('an edited queued entry gets its time on the user’s wall clock, whatever the device zone', () => {
  const form = { exerciseType: 'pushups', date: '2026-10-17', time: '08:30', reps: 25, repsLeft: 0, repsRight: 0, loadKg: null, distance: null };
  // 08:30 in Tokyo (UTC+9) is 23:30 UTC the day before; in New York (EDT, UTC−4) — 12:30 UTC.
  assert.equal(buildQueueEditPatch(form, 'Asia/Tokyo').time, '2026-10-16T23:30:00.000Z');
  assert.equal(buildQueueEditPatch(form, 'America/New_York').time, '2026-10-17T12:30:00.000Z');
  const patch = buildQueueEditPatch(form, 'Europe/Moscow');
  assert.deepEqual(
    { date: patch.date, reps: patch.reps, time: patch.time, loadKg: patch.loadKg, durationSeconds: patch.durationSeconds },
    { date: '2026-10-17', reps: 25, time: '2026-10-17T05:30:00.000Z', loadKg: null, durationSeconds: null },
  );
});

test('a delete the server keeps refusing stays visible with the reason but does not hold back newer entries', () => {
  const tomb = markForServerDelete(item('old', '2026-10-17T08:00:00.000Z'));
  const refused = applyOutcome(markSending(tomb, NOW), { kind: 'rejected', status: 400, message: 'Некорректный clientRequestId' }, NOW).item!;
  const newer = item('new', '2026-10-17T09:00:00.000Z');
  assert.equal(nextSendable([refused, newer], NOW)?.id, 'new');
  assert.deepEqual(queueEntryState(refused), { state: 'deleting', reason: 'Некорректный clientRequestId' });
  // Its pause over, it is tried again.
  assert.equal(nextSendable([refused], new Date(NOW.getTime() + 3600_000))?.id, 'old');
});
