import test from 'node:test';
import assert from 'node:assert/strict';
import { checkApiRequest, type ApiRequestMeta } from './request-guard';

const APP_URL = 'https://tracker.example.com';
const KB = 1024;
const MB = 1024 * 1024;

function meta(
  method: string,
  pathname: string,
  headers: Record<string, string>,
  appUrl: string | null = APP_URL,
): ApiRequestMeta {
  return { method, pathname, headers: new Headers(headers), appUrl };
}

const sameOriginJson = {
  host: 'tracker.example.com',
  origin: 'https://tracker.example.com',
  'content-type': 'application/json',
  'content-length': '42',
};

test('a same-origin JSON POST passes', () => {
  assert.deepEqual(checkApiRequest(meta('POST', '/api/workouts', sameOriginJson)), { ok: true });
});

test('safe methods are never blocked, whatever the origin', () => {
  for (const method of ['GET', 'HEAD', 'OPTIONS']) {
    const verdict = checkApiRequest(
      meta(method, '/api/me', { host: 'tracker.example.com', origin: 'https://evil.example.net' }),
    );
    assert.deepEqual(verdict, { ok: true }, method);
  }
});

test('a foreign Origin on an unsafe method is rejected with 403', () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'post']) {
    const verdict = checkApiRequest(
      meta(method, '/api/admin/users', { ...sameOriginJson, origin: 'https://evil.example.net' }),
    );
    assert.deepEqual(verdict, { ok: false, status: 403, code: 'FORBIDDEN_ORIGIN' }, method);
  }
});

test('a sibling subdomain is a different origin', () => {
  const verdict = checkApiRequest(
    meta('PATCH', '/api/admin/users', { ...sameOriginJson, origin: 'https://other.example.com' }),
  );
  assert.equal(verdict.ok, false);
});

test('Origin "null" (sandboxed frame) is rejected', () => {
  const verdict = checkApiRequest(meta('POST', '/api/workouts', { ...sameOriginJson, origin: 'null' }));
  assert.deepEqual(verdict, { ok: false, status: 403, code: 'FORBIDDEN_ORIGIN' });
});

test('without Origin the Referer decides', () => {
  const base = { host: 'tracker.example.com', 'content-type': 'application/json' };
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/workouts', { ...base, referer: 'https://tracker.example.com/dashboard?x=1' })),
    { ok: true },
  );
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/workouts', { ...base, referer: 'https://evil.example.net/page' })),
    { ok: false, status: 403, code: 'FORBIDDEN_ORIGIN' },
  );
});

test('neither Origin nor Referer → 403', () => {
  const verdict = checkApiRequest(
    meta('POST', '/api/workouts', { host: 'tracker.example.com', 'content-type': 'application/json' }),
  );
  assert.deepEqual(verdict, { ok: false, status: 403, code: 'FORBIDDEN_ORIGIN' });
});

test('behind a proxy the origin may match APP_URL even if Host is internal', () => {
  const verdict = checkApiRequest(
    meta('POST', '/api/workouts', { ...sameOriginJson, host: 'pushup-web:3000' }),
  );
  assert.deepEqual(verdict, { ok: true });
});

test('without APP_URL the request host is the reference (local dev)', () => {
  const headers = { ...sameOriginJson, host: 'localhost:3103', origin: 'http://localhost:3103' };
  assert.deepEqual(checkApiRequest(meta('POST', '/api/workouts', headers, null)), { ok: true });
  assert.equal(
    checkApiRequest(meta('POST', '/api/workouts', { ...headers, origin: 'http://localhost:9999' }, null)).ok,
    false,
  );
});

test('text/plain and form bodies are rejected with 415 (no CORS-free CSRF)', () => {
  for (const contentType of ['text/plain', 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded']) {
    const verdict = checkApiRequest(
      meta('POST', '/api/admin/users', { ...sameOriginJson, 'content-type': contentType }),
    );
    assert.deepEqual(verdict, { ok: false, status: 415, code: 'UNSUPPORTED_CONTENT_TYPE' }, contentType);
  }
});

test('JSON with a charset parameter is accepted', () => {
  const verdict = checkApiRequest(
    meta('PUT', '/api/workouts', { ...sameOriginJson, 'content-type': 'Application/JSON; charset=utf-8' }),
  );
  assert.deepEqual(verdict, { ok: true });
});

test('a bodiless unsafe request without Content-Type passes (logout, DELETE)', () => {
  const headers = { host: 'tracker.example.com', origin: 'https://tracker.example.com' };
  assert.deepEqual(checkApiRequest(meta('POST', '/api/logout', headers)), { ok: true });
  assert.deepEqual(checkApiRequest(meta('DELETE', '/api/friends', { ...headers, 'content-length': '0' })), { ok: true });
});

test('a body without Content-Type is rejected', () => {
  const headers = { host: 'tracker.example.com', origin: 'https://tracker.example.com', 'content-length': '10' };
  assert.deepEqual(checkApiRequest(meta('POST', '/api/workouts', headers)), {
    ok: false,
    status: 415,
    code: 'UNSUPPORTED_CONTENT_TYPE',
  });
});

test('multipart is allowed only on the two avatar endpoints', () => {
  const multipart = { ...sameOriginJson, 'content-type': 'multipart/form-data; boundary=x', 'content-length': String(MB) };
  assert.deepEqual(checkApiRequest(meta('POST', '/api/profile/avatar', multipart)), { ok: true });
  assert.deepEqual(checkApiRequest(meta('POST', '/api/admin/users/avatar', multipart)), { ok: true });
  assert.deepEqual(checkApiRequest(meta('POST', '/api/workouts', multipart)), {
    ok: false,
    status: 415,
    code: 'UNSUPPORTED_CONTENT_TYPE',
  });
});

test('JSON over 64 KB → 413, exactly 64 KB passes', () => {
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/workouts', { ...sameOriginJson, 'content-length': String(64 * KB) })),
    { ok: true },
  );
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/workouts', { ...sameOriginJson, 'content-length': String(64 * KB + 1) })),
    { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' },
  );
});

test('avatar multipart over 5 MB → 413, exactly 5 MB passes', () => {
  const multipart = { ...sameOriginJson, 'content-type': 'multipart/form-data; boundary=x' };
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/profile/avatar', { ...multipart, 'content-length': String(5 * MB) })),
    { ok: true },
  );
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/profile/avatar', { ...multipart, 'content-length': String(5 * MB + 1) })),
    { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' },
  );
});

test('JSON to an avatar endpoint keeps the 64 KB limit', () => {
  const verdict = checkApiRequest(
    meta('DELETE', '/api/profile/avatar', { ...sameOriginJson, 'content-length': String(MB) }),
  );
  assert.deepEqual(verdict, { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' });
});

test('the Telegram webhook skips Origin and Content-Type checks but keeps the size limit', () => {
  const telegram = { host: 'tracker.example.com', 'content-type': 'application/json', 'content-length': '300' };
  assert.deepEqual(checkApiRequest(meta('POST', '/api/telegram/webhook', telegram)), { ok: true });
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/telegram/webhook', { host: 'tracker.example.com', 'content-type': 'text/plain' })),
    { ok: true },
  );
  assert.deepEqual(
    checkApiRequest(meta('POST', '/api/telegram/webhook', { ...telegram, 'content-length': String(MB) })),
    { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' },
  );
});

test('the exemption is exact: a lookalike path is still checked', () => {
  const verdict = checkApiRequest(
    meta('POST', '/api/telegram/webhook-evil', { host: 'tracker.example.com', 'content-type': 'application/json' }),
  );
  assert.equal(verdict.ok, false);
});
