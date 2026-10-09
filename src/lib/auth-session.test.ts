import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { createSession, hashSessionToken, setSessionCookie } from './auth';

const DAY_MS = 24 * 60 * 60 * 1000;

function withNodeEnv<T>(value: string, fn: () => T): T {
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  env.NODE_ENV = value;
  try {
    return fn();
  } finally {
    env.NODE_ENV = previous;
  }
}

test('session tokens are looked up by their SHA-256 hex digest', () => {
  // FIPS 180-2 test vector for "abc".
  assert.equal(hashSessionToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('a new session stores only the hash of the cookie token', async () => {
  const created: Array<Record<string, unknown>> = [];
  const db = {
    session: {
      create: async (args: { data: Record<string, unknown> }) => {
        created.push(args.data);
        return args.data;
      },
      deleteMany: async () => ({ count: 0 }),
    },
  };

  const before = Date.now();
  const { token, expiresAt } = await createSession('user-1', db);

  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(created.length, 1);
  const data = created[0];
  assert.equal(data.userId, 'user-1');
  assert.equal(data.tokenHash, crypto.createHash('sha256').update(token, 'utf8').digest('hex'));
  assert.equal('token' in data, false, 'the raw token must not be written');
  assert.ok(!Object.values(data).includes(token), 'the raw token must not be written under any field');
  const ttl = expiresAt.getTime() - before;
  assert.ok(ttl > 30 * DAY_MS - 60_000 && ttl <= 30 * DAY_MS + 60_000);
});

test('two sessions never share a token', async () => {
  const db = { session: { create: async () => ({}), deleteMany: async () => ({ count: 0 }) } };
  const a = await createSession('u', db);
  const b = await createSession('u', db);
  assert.notEqual(a.token, b.token);
});

test('the session cookie is always secure in production, even behind plain http', () => {
  withNodeEnv('production', () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, 'tok', new Request('http://internal:3000/api/login'));
    const cookie = res.cookies.get('session');
    assert.equal(cookie?.value, 'tok');
    assert.equal(cookie?.secure, true);
    assert.equal(cookie?.httpOnly, true);
  });
});

test('outside production the cookie is secure only over https', () => {
  withNodeEnv('development', () => {
    const plain = NextResponse.json({});
    setSessionCookie(plain, 'tok', new Request('http://localhost:3102/api/login'));
    assert.equal(plain.cookies.get('session')?.secure ?? false, false);

    const proxied = NextResponse.json({});
    setSessionCookie(
      proxied,
      'tok',
      new Request('http://localhost:3102/api/login', { headers: { 'x-forwarded-proto': 'https' } }),
    );
    assert.equal(proxied.cookies.get('session')?.secure, true);
  });
});
