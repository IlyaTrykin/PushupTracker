import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboxBusyError, removeQueuedItem, updateQueuedItem } from './outbox-actions';
import { confirmLogoutWithOutbox } from './logout-guard';
import { SENDING_LEASE_SECONDS, createOutboxItem, markForServerDelete, type OutboxPayload, type SendOutcome } from './outbox-core';
import { outboxStore } from './outbox-store';
import { flushOutbox } from './sync';

// Without IndexedDB (node) the store keeps the queue in memory — same transactional rules.

const T0 = new Date('2026-10-17T10:00:00.000Z');

async function queued(userId: string, reps = 20) {
  const item = createOutboxItem(userId, { exerciseType: 'pushups', reps, date: '2026-10-17', time: '2026-10-17T09:55:00.000Z' }, T0);
  await outboxStore.put(item);
  return item;
}

/** A server whose answer the test releases; `started` resolves when the request went out. */
function slowServer() {
  const received: OutboxPayload[] = [];
  let answer: (outcome: SendOutcome) => void = () => undefined;
  let markStarted: () => void = () => undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const send = (p: OutboxPayload) =>
    new Promise<SendOutcome>((resolve) => {
      received.push(p);
      answer = resolve;
      markStarted();
    });
  return { received, send, started, reply: (outcome: SendOutcome) => answer(outcome) };
}

test('delete that lands while the sender takes the item is refused (no workout left on the server behind the user)', async () => {
  const userId = 'race-remove';
  const item = await queued(userId);
  const server = slowServer();
  let flush: Promise<unknown> = Promise.resolve();

  const removal = removeQueuedItem(userId, item.id, {
    now: () => T0,
    // Taking back the native copy takes a moment; the sender picks the item meanwhile.
    cancelBackground: async () => {
      flush = flushOutbox(userId, { send: server.send, now: () => T0 });
      await server.started;
      return 'none';
    },
  });

  const refusal = await removal.then(() => null, (error: unknown) => error);
  server.reply({ kind: 'created', workoutId: 'w1' });
  await flush;
  assert.ok(refusal instanceof OutboxBusyError, 'delete is refused');
  assert.deepEqual(server.received.map((p) => p.clientRequestId), [item.id]);
  assert.deepEqual(await outboxStore.list(userId), []);
});

test('edit that lands while the sender takes the item is refused, not silently lost', async () => {
  const userId = 'race-edit';
  const item = await queued(userId, 20);
  const server = slowServer();
  let flush: Promise<unknown> = Promise.resolve();

  const edit = updateQueuedItem(userId, item.id, { reps: 35 }, {
    now: () => T0,
    cancelBackground: async () => {
      flush = flushOutbox(userId, { send: server.send, now: () => T0 });
      await server.started;
      return 'none';
    },
  });

  const refusal = await edit.then(() => null, (error: unknown) => error);
  server.reply({ kind: 'created', workoutId: 'w1' });
  await flush;
  assert.ok(refusal instanceof OutboxBusyError, 'edit is refused');
  assert.equal(server.received[0].reps, 20);
  assert.deepEqual(await outboxStore.list(userId), []);
});

test('the send result is written only while the item is still under this sender’s lease', async () => {
  const userId = 'race-lease';
  const item = await queued(userId, 20);
  const server = slowServer();
  let clock = T0;
  const later: OutboxPayload[] = [];
  // First request: answered late by the test. Next ones: the network is gone again.
  const send = (p: OutboxPayload) =>
    server.received.length === 0 ? server.send(p) : (later.push(p), Promise.resolve<SendOutcome>({ kind: 'retry', reason: 'network' }));

  const flush = flushOutbox(userId, { send, now: () => clock });
  await server.started;
  // The answer is late: the lease ran out and the user edited the waiting item.
  clock = new Date(T0.getTime() + (SENDING_LEASE_SECONDS + 60) * 1000);
  await updateQueuedItem(userId, item.id, { reps: 35 }, { now: () => clock, cancelBackground: async () => 'none' });
  server.reply({ kind: 'created', workoutId: 'w1' });
  await flush;

  const left = await outboxStore.list(userId);
  assert.equal(left.length, 1, 'the edit is kept, not removed by the late answer');
  assert.equal(left[0].payload.reps, 35);
  assert.equal(left[0].status, 'pending');
  assert.deepEqual(later.map((p) => p.reps), [35], 'the edit itself goes out next (the server then gets the follow-up edit)');
  await outboxStore.clear(userId);
});

test('edit and delete of a waiting item still work', async () => {
  const userId = 'plain';
  const item = await queued(userId, 20);
  await updateQueuedItem(userId, item.id, { reps: 22 }, { now: () => T0, cancelBackground: async () => 'cancelled' });
  assert.equal((await outboxStore.list(userId))[0].payload.reps, 22);
  await removeQueuedItem(userId, item.id, { now: () => T0, cancelBackground: async () => 'cancelled' });
  assert.deepEqual(await outboxStore.list(userId), []);
});

test('deleting an entry whose answer was lost deletes it on the server: «будет удалена» is stored, then DELETE {clientRequestId} goes out', async () => {
  const userId = 'tomb-lost-answer';
  const item = await queued(userId, 20);
  // The request reached the server, the answer did not come back.
  const posted: string[] = [];
  await flushOutbox(userId, {
    now: () => T0,
    send: async (p) => (posted.push(p.clientRequestId), { kind: 'retry', reason: 'timeout' }),
    sendDelete: async () => ({ kind: 'retry', reason: 'network' }),
  });
  assert.deepEqual(posted, [item.id]);

  await removeQueuedItem(userId, item.id, { now: () => T0, cancelBackground: async () => 'none' });
  const stored = await outboxStore.list(userId);
  assert.equal(stored.length, 1, 'kept on the device until the server confirms');
  assert.equal(stored[0].deleteOnServer, true);

  // Offline: the tombstone stays.
  const deletes: string[] = [];
  const later = new Date(T0.getTime() + 3600_000);
  await flushOutbox(userId, {
    now: () => later,
    send: async (p) => (posted.push(p.clientRequestId), { kind: 'retry', reason: 'network' }),
    sendDelete: async (id) => (deletes.push(id), { kind: 'retry', reason: 'network' }),
  });
  assert.equal((await outboxStore.list(userId))[0]?.deleteOnServer, true);

  // Back online: the server gets the delete, never the workout again.
  const result = await flushOutbox(userId, {
    now: () => new Date(later.getTime() + 3600_000),
    send: async (p) => (posted.push(p.clientRequestId), { kind: 'created', workoutId: 'w1' }),
    sendDelete: async (id) => (deletes.push(id), { kind: 'deleted' }),
  });
  assert.deepEqual(deletes, [item.id, item.id]);
  assert.deepEqual(posted, [item.id], 'the workout itself is not sent again');
  assert.equal(result.deleted, 1);
  assert.deepEqual(await outboxStore.list(userId), []);
});

test('deleting an entry whose native copy already went out is no longer refused: it becomes «будет удалена»', async () => {
  const userId = 'tomb-native-sent';
  const item = await queued(userId, 20);
  await removeQueuedItem(userId, item.id, { now: () => T0, cancelBackground: async () => 'sent' });
  const stored = await outboxStore.list(userId);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].deleteOnServer, true);
  await outboxStore.clear(userId);
});

test('deleting an entry that never left the device removes it at once, nothing goes to the server', async () => {
  const userId = 'tomb-never-sent';
  const item = await queued(userId, 20);
  await removeQueuedItem(userId, item.id, { now: () => T0, cancelBackground: async () => 'cancelled' });
  assert.deepEqual(await outboxStore.list(userId), []);
});

test('«sign out and delete» keeps entries «будет удалена»: they stay with their user and are not counted as unsent', async () => {
  const userId = 'tomb-logout';
  const unsent = await queued(userId, 20);
  const deleted = markForServerDelete(createOutboxItem(userId, { exerciseType: 'pushups', reps: 30, date: '2026-10-17', time: '2026-10-17T09:56:00.000Z' }, T0));
  await outboxStore.put(deleted);
  const asked: number[] = [];
  const offline = { send: async () => ({ kind: 'retry', reason: 'network' }) as SendOutcome, sendDelete: async () => ({ kind: 'retry', reason: 'network' }) as SendOutcome };
  const decision = await confirmLogoutWithOutbox(userId, (count) => (asked.push(count), true), offline);
  assert.equal(decision, 'proceed');
  assert.deepEqual(asked, [1], 'only the unsent workout is asked about');
  assert.deepEqual((await outboxStore.list(userId)).map((i) => i.id), [deleted.id], 'the tombstone waits for the next sign-in');
  assert.deepEqual(await outboxStore.list('someone-else'), []);
  // Only tombstones left: nothing to ask, still kept.
  const again = await confirmLogoutWithOutbox(userId, () => { throw new Error('must not ask'); }, offline);
  assert.equal(again, 'proceed');
  assert.equal((await outboxStore.list(userId)).length, 1);
  void unsent;
  await outboxStore.clear(userId);
});

test('a delete the server refuses (4xx) goes out once per flush and does not hold back the workouts after it, also with ignoreBackoff', async () => {
  const userId = 'tomb-refused';
  const tomb = markForServerDelete(createOutboxItem(userId, { exerciseType: 'pushups', reps: 30, date: '2026-10-17', time: '2026-10-17T09:50:00.000Z' }, T0));
  await outboxStore.put({ ...tomb, attempts: 1, everSent: true });
  const first = await queued(userId, 20);
  const deletes: string[] = [];
  const posted: string[] = [];
  const server = {
    send: async (p: OutboxPayload): Promise<SendOutcome> => (posted.push(p.clientRequestId), { kind: 'created', workoutId: `w-${p.clientRequestId}` }),
    sendDelete: async (id: string): Promise<SendOutcome> => (deletes.push(id), { kind: 'rejected', status: 400, message: 'Invalid clientRequestId' }),
  };

  // The dashboard always flushes with ignoreBackoff.
  const result = await flushOutbox(userId, { ...server, now: () => T0, ignoreBackoff: true });
  assert.deepEqual(deletes, [tomb.id], 'the refused delete is sent once in this flush');
  assert.deepEqual(posted, [first.id], 'the workout after it goes out');
  assert.equal(result.sent, 1);
  assert.equal(result.stopped, undefined);
  const kept = await outboxStore.list(userId);
  assert.deepEqual(kept.map((i) => i.id), [tomb.id], 'the tombstone stays until the server confirms');
  assert.equal(kept[0].deleteOnServer, true);
  assert.equal(kept[0].lastError, 'Invalid clientRequestId');

  // Next save: again one delete try, and the new workout is not held back.
  const second = await queued(userId, 25);
  await flushOutbox(userId, { ...server, now: () => T0, ignoreBackoff: true });
  assert.deepEqual(deletes, [tomb.id, tomb.id]);
  assert.deepEqual(posted, [first.id, second.id]);
  assert.deepEqual((await outboxStore.list(userId)).map((i) => i.id), [tomb.id]);
  await outboxStore.clear(userId);
});

test('a delete waiting for its native copy does not hold back the workouts after it', async () => {
  const userId = 'tomb-native-wait';
  const tomb = markForServerDelete(createOutboxItem(userId, { exerciseType: 'pushups', reps: 30, date: '2026-10-17', time: '2026-10-17T09:50:00.000Z' }, T0));
  await outboxStore.put(tomb);
  const next = await queued(userId, 20);
  const deletes: string[] = [];
  const posted: string[] = [];
  await flushOutbox(userId, {
    now: () => T0,
    ignoreBackoff: true,
    send: async (p) => (posted.push(p.clientRequestId), { kind: 'created', workoutId: 'w1' }),
    sendDelete: async (id) => (deletes.push(id), { kind: 'retry', reason: 'background upload' }),
  });
  assert.deepEqual(deletes, [tomb.id]);
  assert.deepEqual(posted, [next.id]);
  await outboxStore.clear(userId);
});

test('without a connection a failed delete still stops the flush (no pointless requests)', async () => {
  const userId = 'tomb-offline-stop';
  const tomb = markForServerDelete(createOutboxItem(userId, { exerciseType: 'pushups', reps: 30, date: '2026-10-17', time: '2026-10-17T09:50:00.000Z' }, T0));
  await outboxStore.put(tomb);
  await queued(userId, 20);
  const posted: string[] = [];
  const result = await flushOutbox(userId, {
    now: () => T0,
    ignoreBackoff: true,
    send: async (p) => (posted.push(p.clientRequestId), { kind: 'retry', reason: 'network' }),
    sendDelete: async () => ({ kind: 'retry', reason: 'network' }),
  });
  assert.deepEqual(posted, []);
  assert.equal(result.stopped, 'offline');
  assert.equal(result.retryReason, 'network');
  await outboxStore.clear(userId);
});
