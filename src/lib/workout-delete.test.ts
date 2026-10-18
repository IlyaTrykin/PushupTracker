import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteOwnWorkoutByRequestId, parseWorkoutDeleteBody, type WorkoutDeleteDb } from './workout-delete';

type Row = { id: string; userId: string; clientRequestId: string | null };

function store(rows: Row[]) {
  const db: WorkoutDeleteDb = {
    workout: {
      deleteMany: async ({ where }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].userId === where.userId && rows[i].clientRequestId === where.clientRequestId) rows.splice(i, 1);
        }
        return { count: before - rows.length };
      },
    },
  };
  return db;
}

test('DELETE body: {id} keeps the old path (with groupId for a group owner); id wins over clientRequestId', () => {
  assert.deepEqual(parseWorkoutDeleteBody({ id: ' w1 ' }), { ok: true, target: { by: 'id', id: 'w1', groupId: null } });
  assert.deepEqual(parseWorkoutDeleteBody({ id: 'w1', groupId: 'g1' }), { ok: true, target: { by: 'id', id: 'w1', groupId: 'g1' } });
  assert.deepEqual(parseWorkoutDeleteBody({ id: 'w1', clientRequestId: 'q:1' }), { ok: true, target: { by: 'id', id: 'w1', groupId: null } });
});

test('DELETE body: {clientRequestId} — the outbox deletes a record it may have sent', () => {
  assert.deepEqual(parseWorkoutDeleteBody({ clientRequestId: 'hk:7f3a-1' }), { ok: true, target: { by: 'clientRequestId', clientRequestId: 'hk:7f3a-1' } });
});

test('DELETE body: neither id nor a valid clientRequestId → 400', () => {
  assert.deepEqual(parseWorkoutDeleteBody({}), { ok: false, error: 'id обязателен' });
  assert.deepEqual(parseWorkoutDeleteBody(null), { ok: false, error: 'id обязателен' });
  assert.deepEqual(parseWorkoutDeleteBody({ id: '  ' }), { ok: false, error: 'id обязателен' });
  for (const clientRequestId of ['has space', 'x'.repeat(65), 42, '']) {
    const parsed = parseWorkoutDeleteBody({ clientRequestId });
    assert.equal(parsed.ok, false, JSON.stringify(clientRequestId));
  }
  assert.deepEqual(parseWorkoutDeleteBody({ clientRequestId: 'bad id' }), { ok: false, error: 'Некорректный clientRequestId', code: 'WORKOUT_REQUEST_ID_INVALID' });
});

test('delete by clientRequestId removes only the caller\'s own workout', async () => {
  const rows: Row[] = [
    { id: 'w1', userId: 'u1', clientRequestId: 'q:1' },
    { id: 'w2', userId: 'u2', clientRequestId: 'q:1' },
    { id: 'w3', userId: 'u1', clientRequestId: 'q:2' },
  ];
  assert.deepEqual(await deleteOwnWorkoutByRequestId('u1', 'q:1', store(rows)), { ok: true, deleted: 1 });
  assert.deepEqual(rows.map((row) => row.id), ['w2', 'w3']);
});

test('delete by clientRequestId is idempotent: no such workout (never arrived, deleted already, someone else\'s) → ok', async () => {
  const rows: Row[] = [{ id: 'w2', userId: 'u2', clientRequestId: 'q:1' }];
  const db = store(rows);
  assert.deepEqual(await deleteOwnWorkoutByRequestId('u1', 'q:1', db), { ok: true, deleted: 0 });
  assert.deepEqual(await deleteOwnWorkoutByRequestId('u1', 'q:9', db), { ok: true, deleted: 0 });
  assert.equal(rows.length, 1);
});
