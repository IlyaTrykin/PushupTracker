import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PasswordResetConfigError,
  buildPasswordResetUrl,
  consumePasswordResetToken,
  createPasswordResetToken,
  sendPasswordResetEmail,
} from './password-reset';

type Row = { id: string; userId: string; tokenHash: string; expiresAt: Date; usedAt: Date | null };
type Where = {
  id?: string;
  userId?: string;
  tokenHash?: string;
  usedAt?: null | { not: null };
  expiresAt?: { gt?: Date; lt?: Date };
  OR?: Where[];
};

/** In-memory stand-in for `prisma.passwordResetToken`; every call yields like a real query. */
function fakeStore() {
  const rows: Row[] = [];
  let seq = 0;
  const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
  const matches = (row: Row, where: Where): boolean => {
    if (where.OR) return where.OR.some((w) => matches(row, w));
    if (where.id !== undefined && row.id !== where.id) return false;
    if (where.userId !== undefined && row.userId !== where.userId) return false;
    if (where.tokenHash !== undefined && row.tokenHash !== where.tokenHash) return false;
    if (where.usedAt === null && row.usedAt !== null) return false;
    if (where.usedAt && 'not' in where.usedAt && row.usedAt === null) return false;
    if (where.expiresAt?.gt && !(row.expiresAt > where.expiresAt.gt)) return false;
    if (where.expiresAt?.lt && !(row.expiresAt < where.expiresAt.lt)) return false;
    return true;
  };
  const store = {
    passwordResetToken: {
      async create({ data }: { data: Omit<Row, 'id' | 'usedAt'> }) {
        await tick();
        const row = { id: `r${(seq += 1)}`, usedAt: null, ...data };
        rows.push(row);
        return row;
      },
      async findUnique({ where }: { where: { tokenHash: string } }) {
        await tick();
        const row = rows.find((r) => r.tokenHash === where.tokenHash);
        return row ? { ...row } : null;
      },
      async update({ where, data }: { where: { id: string }; data: Partial<Row> }) {
        await tick();
        const row = rows.find((r) => r.id === where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return { ...row };
      },
      async updateMany({ where, data }: { where: Where; data: Partial<Row> }) {
        await tick();
        const hit = rows.filter((r) => matches(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
      async deleteMany({ where }: { where: Where }) {
        await tick();
        const keep = rows.filter((r) => !matches(r, where));
        const count = rows.length - keep.length;
        rows.splice(0, rows.length, ...keep);
        return { count };
      },
    },
  };
  return store;
}

function withEnv<T>(patch: Record<string, string | undefined>, fn: () => T): T {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, env[k]]));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

test('a reset token can be used once, even by two simultaneous requests', async () => {
  const db = fakeStore();
  const { token } = await createPasswordResetToken('user-1', db);
  const results = await Promise.all([consumePasswordResetToken(token, db), consumePasswordResetToken(token, db)]);
  assert.deepEqual(
    results.filter(Boolean).map((r) => r?.userId),
    ['user-1'],
  );
  assert.equal(await consumePasswordResetToken(token, db), null);
});

test('requesting a new link cancels the previous one', async () => {
  const db = fakeStore();
  const first = await createPasswordResetToken('user-1', db);
  const second = await createPasswordResetToken('user-1', db);
  assert.equal(await consumePasswordResetToken(first.token, db), null);
  assert.deepEqual(await consumePasswordResetToken(second.token, db), { userId: 'user-1' });
});

test('an unknown token is refused', async () => {
  const db = fakeStore();
  await createPasswordResetToken('user-1', db);
  assert.equal(await consumePasswordResetToken('deadbeef', db), null);
});

test('in production the reset link is built only from APP_URL', () => {
  const request = new Request('https://evil.example/api/auth/forgot-password');
  withEnv({ NODE_ENV: 'production', APP_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }, () => {
    assert.throws(() => buildPasswordResetUrl('tok', request), PasswordResetConfigError);
  });
  withEnv({ NODE_ENV: 'production', APP_URL: 'https://app.example/', NEXT_PUBLIC_APP_URL: undefined }, () => {
    assert.equal(buildPasswordResetUrl('a b', request), 'https://app.example/reset-password?token=a%20b');
  });
  withEnv({ NODE_ENV: 'development', APP_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }, () => {
    assert.equal(
      buildPasswordResetUrl('tok', new Request('http://localhost:3102/api/auth/forgot-password')),
      'http://localhost:3102/reset-password?token=tok',
    );
  });
});

async function withEnvAsync<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, env[k]]));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

test('without SMTP the reset link is logged only outside production', async () => {
  const resetUrl = 'https://app.example/reset-password?token=secret-token-value';
  const captured: string[] = [];
  const original = console.info;
  console.info = (...args: unknown[]) => {
    captured.push(JSON.stringify(args));
  };
  const smtpOff = { SMTP_HOST: undefined, SMTP_PORT: undefined, SMTP_USER: undefined, SMTP_PASS: undefined };
  try {
    const params = { to: 'a@b.ru', username: 'a', resetUrl, expiresAt: new Date('2026-10-09T12:00:00Z') };
    await withEnvAsync({ ...smtpOff, NODE_ENV: 'production' }, () => sendPasswordResetEmail(params));
    assert.ok(captured.length > 0, 'something is logged');
    assert.ok(!captured.some((line) => line.includes('secret-token-value')), 'no reset link in production logs');

    captured.length = 0;
    await withEnvAsync({ ...smtpOff, NODE_ENV: 'development' }, () => sendPasswordResetEmail(params));
    assert.ok(captured.some((line) => line.includes('secret-token-value')), 'dev log carries the link');
  } finally {
    console.info = original;
  }
});
