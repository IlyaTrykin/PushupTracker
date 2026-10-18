import assert from 'node:assert/strict';
import test from 'node:test';
import { OutboxBusyError, removeQueuedItem, updateQueuedItem } from './outbox-actions';
import { SENDING_LEASE_SECONDS, createOutboxItem, type OutboxPayload, type SendOutcome } from './outbox-core';
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
