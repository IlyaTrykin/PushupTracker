import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRateLimitWindow, type RateLimitBucketState } from './rate-limit';
import {
  PUSH_DEVICE_REGISTER_LIMIT_PER_HOUR,
  registerPushDevice,
  releasePushTokenOnLogout,
  removePushDevice,
  type PushDeviceDb,
  type PushDeviceDeps,
} from './push-devices';

type Row = { id: string; userId: string; platform: string; token: string; isActive: boolean; updatedAt: Date };
type Where = { id?: { in: string[] }; userId?: string; token?: string | { in: string[] }; isActive?: boolean };

const IOS = 'AB'.repeat(32);
const ios = (n: number) => n.toString(16).padStart(2, '0').repeat(32);
const ANDROID = 'fcm-token_ABCdef:123-xyz.' + 'q'.repeat(40);

/** In-memory `pushDevice` with Prisma's semantics for the calls the module makes (unique token). */
function world(seed: Array<Partial<Row> & { userId: string; token: string }> = []) {
  let clock = Date.parse('2026-10-18T10:00:00.000Z');
  const tick = () => new Date((clock += 1000));
  let ids = 0;
  const rows: Row[] = seed.map((row) => ({ id: `d${++ids}`, platform: 'ios', isActive: true, updatedAt: tick(), ...row }));
  const matches = (row: Row, where: Where) =>
    (where.id === undefined || where.id.in.includes(row.id)) &&
    (where.userId === undefined || row.userId === where.userId) &&
    (where.isActive === undefined || row.isActive === where.isActive) &&
    (where.token === undefined || (typeof where.token === 'string' ? row.token === where.token : where.token.in.includes(row.token)));
  let raceOnce = false;

  const db: PushDeviceDb = {
    pushDevice: {
      upsert: async ({ where, update, create }) => {
        if (raceOnce) {
          raceOnce = false;
          rows.push({ id: `d${++ids}`, userId: 'racer', platform: create.platform, token: create.token, isActive: true, updatedAt: tick() });
          throw Object.assign(new Error('Unique constraint failed on token'), { code: 'P2002' });
        }
        const existing = rows.find((row) => row.token === where.token);
        if (existing) Object.assign(existing, update, { updatedAt: tick() });
        else rows.push({ id: `d${++ids}`, ...create, isActive: create.isActive, updatedAt: tick() });
        return {};
      },
      updateMany: async ({ where, data }) => {
        const hit = rows.filter((row) => matches(row, where));
        for (const row of hit) Object.assign(row, data, { updatedAt: tick() });
        return { count: hit.length };
      },
      findMany: async ({ where }) => rows.filter((row) => matches(row, where)).map(({ id, updatedAt }) => ({ id, updatedAt })),
      deleteMany: async ({ where }) => {
        const before = rows.length;
        for (let i = rows.length - 1; i >= 0; i -= 1) if (matches(rows[i], where)) rows.splice(i, 1);
        return { count: before - rows.length };
      },
    },
  };

  // The real fixed-window rule over an in-memory bucket table and a movable clock.
  const buckets = new Map<string, RateLimitBucketState>();
  let now = new Date('2026-10-18T10:00:00.000Z');
  const deps: PushDeviceDeps = {
    db,
    hitRateLimit: async (key, limit, windowSeconds) => {
      const decision = applyRateLimitWindow(buckets.get(key) ?? null, now, limit, windowSeconds);
      buckets.set(key, decision.bucket);
      return { ok: decision.ok, retryAfterSeconds: decision.retryAfterSeconds };
    },
  };
  return {
    rows,
    db,
    deps,
    raceNextUpsert: () => {
      raceOnce = true;
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms);
    },
    of: (token: string) => rows.filter((row) => row.token === token),
  };
}

test('register: a new device is stored active for the user, an APNs token lower-cased', async () => {
  const w = world();
  assert.deepEqual(await registerPushDevice('u1', { platform: 'ios', token: IOS }, w.deps), { ok: true });
  assert.deepEqual(w.rows.map(({ userId, platform, token, isActive }) => ({ userId, platform, token, isActive })), [
    { userId: 'u1', platform: 'ios', token: IOS.toLowerCase(), isActive: true },
  ]);
});

test('register: garbage platform or token → 400, nothing stored', async () => {
  const w = world();
  for (const body of [null, {}, { platform: 'web', token: IOS }, { platform: 'ios', token: 'zz' }, { platform: 'android', token: 'short' }, { platform: 'ios', token: 42 }]) {
    const result = await registerPushDevice('u1', body, w.deps);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(!result.ok && result.status, 400, JSON.stringify(body));
  }
  assert.equal(w.rows.length, 0);
});

test('register: a token registered by another account moves to this one and is switched back on', async () => {
  const w = world([{ userId: 'old', token: IOS.toLowerCase(), isActive: false }]);
  assert.equal((await registerPushDevice('u1', { platform: 'ios', token: IOS }, w.deps)).ok, true);
  assert.deepEqual(w.of(IOS.toLowerCase()).map(({ userId, isActive }) => ({ userId, isActive })), [{ userId: 'u1', isActive: true }]);
});

test('register: two registrations of one token at once — the loser takes the row over (unique token)', async () => {
  const w = world();
  w.raceNextUpsert();
  assert.deepEqual(await registerPushDevice('u1', { platform: 'android', token: ANDROID }, w.deps), { ok: true });
  assert.deepEqual(w.of(ANDROID).map(({ userId, isActive }) => ({ userId, isActive })), [{ userId: 'u1', isActive: true }]);
});

test('register: at most 10 active devices per user — the 11th switches off the oldest; other users are untouched', async () => {
  const w = world([
    ...Array.from({ length: 10 }, (_, n) => ({ userId: 'u1', token: ios(n + 1) })),
    { userId: 'u2', token: ios(200) },
  ]);
  assert.equal((await registerPushDevice('u1', { platform: 'ios', token: ios(100) }, w.deps)).ok, true);
  const active = w.rows.filter((row) => row.userId === 'u1' && row.isActive).map((row) => row.token);
  assert.equal(active.length, 10);
  assert.ok(!active.includes(ios(1)), 'the oldest is switched off');
  assert.ok(active.includes(ios(100)), 'the new one is on');
  assert.equal(w.of(ios(1))[0].isActive, false, 'switched off, not deleted');
  assert.equal(w.of(ios(200))[0].isActive, true);
});

test(`register: at most ${PUSH_DEVICE_REGISTER_LIMIT_PER_HOUR} POSTs an hour per user → 429 with the wait, nothing written`, async () => {
  assert.equal(PUSH_DEVICE_REGISTER_LIMIT_PER_HOUR, 20);
  const w = world();
  for (let n = 0; n < 20; n += 1) {
    assert.equal((await registerPushDevice('u1', { platform: 'ios', token: IOS }, w.deps)).ok, true, `attempt ${n + 1}`);
  }
  w.advance(10 * 60 * 1000);
  const refused = await registerPushDevice('u1', { platform: 'android', token: ANDROID }, w.deps);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.status, 429);
  assert.equal(!refused.ok && refused.status === 429 && refused.retryAfterSeconds, 50 * 60);
  assert.equal(w.of(ANDROID).length, 0);

  assert.equal((await registerPushDevice('u2', { platform: 'android', token: ANDROID }, w.deps)).ok, true, 'another user has his own limit');
  w.advance(50 * 60 * 1000);
  assert.equal((await registerPushDevice('u1', { platform: 'ios', token: IOS }, w.deps)).ok, true, 'a new hour, a new window');
});

test('register: garbage attempts count against the limit too', async () => {
  const w = world();
  for (let n = 0; n < 20; n += 1) await registerPushDevice('u1', { platform: 'ios', token: 'zz' }, w.deps);
  const refused = await registerPushDevice('u1', { platform: 'ios', token: IOS }, w.deps);
  assert.equal(!refused.ok && refused.status, 429);
});

test('remove: the device with this token goes, whoever owns it; the token as sent or as stored', async () => {
  const w = world([{ userId: 'other', token: IOS.toLowerCase() }, { userId: 'u1', platform: 'android', token: ANDROID }]);
  assert.deepEqual(await removePushDevice({ token: IOS }, w.db), { ok: true });
  assert.equal(w.of(IOS.toLowerCase()).length, 0);
  assert.deepEqual(await removePushDevice({ token: ` ${ANDROID} ` }, w.db), { ok: true });
  assert.equal(w.rows.length, 0);
  assert.deepEqual(await removePushDevice({ token: ANDROID }, w.db), { ok: true }, 'idempotent');
});

test('remove: no token → 400', async () => {
  const w = world([{ userId: 'u1', token: IOS.toLowerCase() }]);
  for (const body of [null, {}, { token: '' }, { token: '  ' }, { token: 7 }]) {
    const result = await removePushDevice(body, w.db);
    assert.equal(!result.ok && result.status, 400, JSON.stringify(body));
  }
  assert.equal(w.rows.length, 1);
});

test('logout with pushToken: the signed-in owner\'s device is removed', async () => {
  const w = world([{ userId: 'u1', token: IOS.toLowerCase() }, { userId: 'u1', token: ios(9) }]);
  await releasePushTokenOnLogout(IOS, 'u1', w.db);
  assert.deepEqual(w.rows.map((row) => row.token), [ios(9)], 'only the device of this phone');
});

test('logout with pushToken the session cannot vouch for (expired, another account): switched off, never deleted', async () => {
  const w = world([{ userId: 'other', token: IOS.toLowerCase() }, { userId: 'u1', platform: 'android', token: ANDROID }]);
  await releasePushTokenOnLogout(IOS, 'u1', w.db);
  await releasePushTokenOnLogout(ANDROID, null, w.db);
  assert.deepEqual(w.rows.map(({ userId, isActive }) => ({ userId, isActive })), [
    { userId: 'other', isActive: false },
    { userId: 'u1', isActive: false },
  ]);
});

test('logout without pushToken touches no device', async () => {
  const w = world([{ userId: 'u1', token: IOS.toLowerCase() }]);
  await releasePushTokenOnLogout('', 'u1', w.db);
  await releasePushTokenOnLogout('   ', null, w.db);
  assert.deepEqual(w.rows.map(({ isActive }) => isActive), [true]);
});
