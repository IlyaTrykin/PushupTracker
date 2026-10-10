import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { registerAccount, type RegisterStore } from '../app/api/register/register-account';
import { authRateLimitRules, authText, requestLocale, resolveLoginOutcome, verifyPassword } from './auth';

test('an unknown user and a wrong password get the same answer', () => {
  assert.equal(resolveLoginOutcome(null, false), 'invalid_credentials');
  assert.equal(resolveLoginOutcome({ deletedAt: null }, false), 'invalid_credentials');
});

test('a deleted account is revealed only after the right password', () => {
  const deleted = { deletedAt: new Date('2026-01-01T00:00:00Z') };
  assert.equal(resolveLoginOutcome(deleted, false), 'invalid_credentials');
  assert.equal(resolveLoginOutcome(deleted, true), 'account_deleted');
  assert.equal(resolveLoginOutcome({ deletedAt: null }, true), 'ok');
});

test('a password check without a user still runs bcrypt and fails', async () => {
  const realHash = await bcrypt.hash('correct horse', 10);
  assert.equal(await verifyPassword('correct horse', realHash), true);
  assert.equal(await verifyPassword('wrong', realHash), false);

  // The first no-user call also builds the throwaway hash; every later call must still
  // cost a real bcrypt compare, so only repeated calls are measured. The fastest of a few
  // runs is compared (load only slows a run down), with a wide margin: a path that skips
  // bcrypt takes microseconds against tens of milliseconds for a real compare.
  assert.equal(await verifyPassword('correct horse', null), false);
  const fastest = async (fn: () => Promise<unknown>) => {
    let best = Infinity;
    for (let i = 0; i < 3; i += 1) {
      const started = performance.now();
      await fn();
      best = Math.min(best, performance.now() - started);
    }
    return best;
  };
  const missingUserMs = await fastest(async () => assert.equal(await verifyPassword('correct horse', null), false));
  const realMs = await fastest(() => verifyPassword('wrong', realHash));
  assert.ok(missingUserMs > realMs / 5, `no-user check took ${missingUserMs.toFixed(1)} ms vs ${realMs.toFixed(1)} ms`);
});

test('rate limits follow story 5', () => {
  assert.deepEqual(authRateLimitRules.login('1.2.3.4', 'Demo'), [
    { key: 'login:ip-user:1.2.3.4:demo', limit: 10, windowSeconds: 15 * 60 },
    { key: 'login:ip:1.2.3.4', limit: 50, windowSeconds: 15 * 60 },
  ]);
  assert.deepEqual(authRateLimitRules.register('1.2.3.4'), [
    { key: 'register:ip:1.2.3.4', limit: 5, windowSeconds: 60 * 60 },
  ]);
  assert.deepEqual(authRateLimitRules.forgotPassword('1.2.3.4', 'a@b.ru'), [
    { key: 'forgot-password:email:a@b.ru', limit: 3, windowSeconds: 60 * 60 },
    { key: 'forgot-password:ip:1.2.3.4', limit: 10, windowSeconds: 60 * 60 },
  ]);
  assert.deepEqual(authRateLimitRules.resetPassword('1.2.3.4'), [
    { key: 'reset-password:ip:1.2.3.4', limit: 10, windowSeconds: 60 * 60 },
  ]);
  assert.deepEqual(authRateLimitRules.changePassword('user-1'), [
    { key: 'change-password:user:user-1', limit: 5, windowSeconds: 15 * 60 },
  ]);
});

test('server texts follow the language cookie, then Accept-Language', () => {
  const withCookie = new Request('http://x/api/login', {
    headers: { cookie: 'session=abc; preferred_locale=en', 'accept-language': 'ru-RU' },
  });
  assert.equal(requestLocale(withCookie), 'en');
  const byHeader = new Request('http://x/api/login', { headers: { 'accept-language': 'en-US,en;q=0.9' } });
  assert.equal(requestLocale(byHeader), 'en');
  assert.equal(requestLocale(new Request('http://x/api/login')), 'ru');
});

type FakeUser = { id: string; email: string; username: string; passwordHash: string; language: string };

/** In-memory `prisma.user` with the DB rules: unique email and unique lower(username). */
function fakeUsers(initial: Array<Pick<FakeUser, 'email' | 'username'>> = []) {
  const rows: FakeUser[] = initial.map((u, i) => ({ id: `u${i}`, passwordHash: 'x', language: 'ru', ...u }));
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const db: RegisterStore = {
    user: {
      async findFirst({ where }) {
        await tick();
        const [byName, byEmail] = where.OR;
        const hit = rows.find(
          (r) => r.username.toLowerCase() === byName.username.equals.toLowerCase() || r.email === byEmail.email,
        );
        return hit ? { id: hit.id } : null;
      },
      async create({ data }) {
        await tick();
        if (rows.some((r) => r.email === data.email || r.username.toLowerCase() === data.username.toLowerCase())) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: 'test',
            meta: { target: 'User_username_lower_key' },
          });
        }
        const row = { id: `u${rows.length}`, ...data };
        rows.push(row);
        return { id: row.id, email: row.email, username: row.username, language: row.language };
      },
    },
  };
  return { db, rows };
}

const newAccount = (username: string, email: string) => ({ username, email, passwordHash: 'hash', language: 'ru' });
const TAKEN = { ok: false, status: 409, code: 'ACCOUNT_TAKEN' };

test('a taken username and a taken email get one and the same answer', async () => {
  const { db } = fakeUsers([{ username: 'Demo', email: 'demo@example.com' }]);
  const byName = await registerAccount(newAccount('dEMO', 'other@example.com'), db);
  const byEmail = await registerAccount(newAccount('fresh', 'demo@example.com'), db);
  assert.deepEqual(byName, TAKEN);
  assert.deepEqual(byEmail, TAKEN);
  // The route turns the outcome into `{ error: authText(locale).accountTaken, code }` — one text for both.
  assert.equal(authText('ru').accountTaken, 'Ник или email уже заняты');
  assert.equal(authText('en').accountTaken, 'Username or email is already taken');
});

test('simultaneous «Demo» and «demo» end with one account and a 409', async () => {
  const { db, rows } = fakeUsers();
  const results = await Promise.all([
    registerAccount(newAccount('Demo', 'a@example.com'), db),
    registerAccount(newAccount('demo', 'b@example.com'), db),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.deepEqual(
    results.find((r) => !r.ok),
    TAKEN,
  );
});

test('a free username and email create the account', async () => {
  const { db } = fakeUsers([{ username: 'Demo', email: 'demo@example.com' }]);
  const result = await registerAccount(newAccount('Demo2', 'demo2@example.com'), db);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.user.username, 'Demo2');
});
