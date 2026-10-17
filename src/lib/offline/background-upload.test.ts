import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBackgroundRequest, cancelVerdict, planBackgroundReconcile, type BackgroundUploadRecord } from './background-upload';
import { createOutboxItem, type OutboxItem } from './outbox-core';

const NOW = new Date('2026-10-17T10:00:00.000Z');
const TOKEN = 'a'.repeat(64);

function item(id: string, overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    ...createOutboxItem('u1', { exerciseType: 'pushups', reps: 20, date: '2026-10-17', time: '2026-10-17T09:55:00.000Z', clientRequestId: id }, NOW),
    ...overrides,
  };
}

test('the background request is the JS request: API address, Bearer, X-Client native, same JSON body', () => {
  const request = buildBackgroundRequest(item('req-1', { payload: { ...item('req-1').payload, loadKg: null } }), {
    apiBase: 'https://api.example.test/',
    token: TOKEN,
    appVersion: '1.0+3',
    locale: 'ru',
  });
  assert.ok(request);
  assert.equal(request.url, 'https://api.example.test/api/workouts');
  assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(request.headers['x-client'], 'native');
  assert.equal(request.headers['x-app-version'], '1.0+3');
  assert.equal(request.headers['accept-language'], 'ru');
  assert.equal(request.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(request.body), {
    exerciseType: 'pushups',
    reps: 20,
    date: '2026-10-17',
    time: '2026-10-17T09:55:00.000Z',
    clientRequestId: 'req-1',
  });
});

test('without a token or a server address nothing is handed to the background sender', () => {
  assert.equal(buildBackgroundRequest(item('a'), { apiBase: 'https://api.example.test', token: null, appVersion: '', locale: 'ru' }), null);
  assert.equal(buildBackgroundRequest(item('a'), { apiBase: '', token: TOKEN, appVersion: '', locale: 'ru' }), null);
});

test('a mirrored item the plugin could not cancel is already sent; an unmirrored one has nothing to cancel', () => {
  assert.equal(cancelVerdict(true, true), 'cancelled');
  assert.equal(cancelVerdict(false, true), 'cancelled');
  assert.equal(cancelVerdict(true, false), 'sent');
  assert.equal(cancelVerdict(false, false), 'none');
});

test('reconcile hands over waiting items without a live native copy and leaves live ones alone', () => {
  const items = [item('new'), item('failed-401'), item('queued'), item('running'), item('done-not-flushed'), item('rejected', { status: 'rejected' }), item('sent-and-pruned')];
  const native: BackgroundUploadRecord[] = [
    { id: 'failed-401', state: 'failed', httpStatus: 401 },
    { id: 'queued', state: 'queued' },
    { id: 'running', state: 'running' },
    { id: 'done-not-flushed', state: 'done', httpStatus: 201 },
  ];
  const mirrored = new Set(['failed-401', 'queued', 'running', 'done-not-flushed', 'sent-and-pruned']);
  const plan = planBackgroundReconcile(items, native, mirrored);
  assert.deepEqual(plan.mirror, ['new', 'failed-401']);
  assert.deepEqual(plan.cancel, []);
  assert.deepEqual(plan.forget, []);
});

test('reconcile clears finished native records whose item left the outbox, keeps foreign live ones', () => {
  const native: BackgroundUploadRecord[] = [
    { id: 'sent-by-js', state: 'done', httpStatus: 200 },
    { id: 'deleted-after-4xx', state: 'failed', httpStatus: 400 },
    { id: 'other-account-queued', state: 'queued' },
  ];
  const mirrored = new Set(['sent-by-js', 'deleted-after-4xx', 'other-account-queued', 'gone']);
  const plan = planBackgroundReconcile([], native, mirrored);
  assert.deepEqual(plan.mirror, []);
  assert.deepEqual(plan.cancel, ['sent-by-js', 'deleted-after-4xx']);
  assert.deepEqual(plan.forget.sort(), ['deleted-after-4xx', 'gone', 'sent-by-js']);
});
