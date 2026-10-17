import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyOutcome,
  backoffSeconds,
  classifyResponse,
  createOutboxItem,
  editOutboxItem,
  markSending,
  needsFollowUpEdit,
  nextSendable,
  pendingPoints,
  resolveEntryMoment,
  toRequestBody,
  type OutboxItem,
  type OutboxPayload,
} from './outbox-core';

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
