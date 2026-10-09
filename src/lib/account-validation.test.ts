import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEmail, validateNewPassword, validateNewUsername } from './account-validation';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail(' Ivan@Mail.RU '), 'ivan@mail.ru');
  assert.equal(normalizeEmail('a.b+tag@sub.example.com'), 'a.b+tag@sub.example.com');
});

test('normalizeEmail rejects malformed, oversized and non-string input', () => {
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail('   '), null);
  assert.equal(normalizeEmail('ivan'), null);
  assert.equal(normalizeEmail('ivan@'), null);
  assert.equal(normalizeEmail('@mail.ru'), null);
  assert.equal(normalizeEmail('ivan@mail'), null);
  assert.equal(normalizeEmail('iv an@mail.ru'), null);
  assert.equal(normalizeEmail('a@b@mail.ru'), null);
  assert.equal(normalizeEmail('"Ivan" <ivan@mail.ru>'), null);
  assert.equal(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(187)}.ru`), null); // 255 chars
  assert.equal(normalizeEmail(`${'a'.repeat(64)}@${'b'.repeat(186)}.ru`), `${'a'.repeat(64)}@${'b'.repeat(186)}.ru`); // 254
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(42), null);
  assert.equal(normalizeEmail({ email: 'ivan@mail.ru' }), null);
});

test('validateNewUsername allows 3–32 latin letters, digits, dot, underscore, dash', () => {
  assert.deepEqual(validateNewUsername('ivan_t.92-x'), { ok: true, value: 'ivan_t.92-x' });
  assert.deepEqual(validateNewUsername('  Ivan  '), { ok: true, value: 'Ivan' });
  assert.deepEqual(validateNewUsername('abc'), { ok: true, value: 'abc' });
  assert.deepEqual(validateNewUsername('a'.repeat(32)), { ok: true, value: 'a'.repeat(32) });

  for (const bad of ['', '  ', 'ab', 'a'.repeat(33), 'иван', 'ivan t', 'ivan@x', '<script>', null, 42]) {
    const result = validateNewUsername(bad);
    assert.equal(result.ok, false, `expected rejection for ${JSON.stringify(bad)}`);
    if (!result.ok) assert.equal(typeof result.code, 'string');
  }
});

test('validateNewPassword requires 8–128 characters', () => {
  assert.deepEqual(validateNewPassword('1234567'), { ok: false, code: 'PASSWORD_TOO_SHORT' });
  assert.deepEqual(validateNewPassword('12345678'), { ok: true });
  assert.deepEqual(validateNewPassword('x'.repeat(128)), { ok: true });
  assert.deepEqual(validateNewPassword('x'.repeat(129)), { ok: false, code: 'PASSWORD_TOO_LONG' });
  assert.deepEqual(validateNewPassword(''), { ok: false, code: 'PASSWORD_REQUIRED' });
  assert.deepEqual(validateNewPassword(undefined), { ok: false, code: 'PASSWORD_REQUIRED' });
  assert.deepEqual(validateNewPassword(12345678), { ok: false, code: 'PASSWORD_REQUIRED' });
});
