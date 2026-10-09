import test from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
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

  // Same cost as a real check: the no-user path must not return instantly.
  const started = performance.now();
  assert.equal(await verifyPassword('correct horse', null), false);
  const missingUserMs = performance.now() - started;
  const startedReal = performance.now();
  await verifyPassword('wrong', realHash);
  const realMs = performance.now() - startedReal;
  assert.ok(missingUserMs > realMs / 4, `no-user check took ${missingUserMs.toFixed(1)} ms vs ${realMs.toFixed(1)} ms`);
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

test('a taken username and a taken email produce one shared text', () => {
  assert.equal(authText('ru').accountTaken, 'Ник или email уже заняты');
  assert.equal(authText('en').accountTaken, 'Username or email is already taken');
});
