import assert from 'node:assert/strict';
import test from 'node:test';
import { rewriteRequest, type NativeFetchContext } from './native-fetch';

const TOKEN = 'a'.repeat(64);
const ctx: NativeFetchContext = { apiBase: 'https://api.example.test', token: TOKEN, appVersion: '1.2.3', locale: 'en' };

function header(init: RequestInit, name: string): string | null {
  return new Headers(init.headers).get(name);
}

test('/api/* goes to the server with the bearer token and app headers', () => {
  const result = rewriteRequest('/api/workouts?date=2026-10-17', { method: 'POST', body: '{}' }, ctx);
  assert.equal(result.isApi, true);
  assert.equal(result.url, 'https://api.example.test/api/workouts?date=2026-10-17');
  assert.equal(result.init.method, 'POST');
  assert.equal(result.init.body, '{}');
  assert.equal(result.init.credentials, 'omit');
  assert.equal(header(result.init, 'Authorization'), `Bearer ${TOKEN}`);
  assert.equal(header(result.init, 'X-Client'), 'native');
  assert.equal(header(result.init, 'X-App-Version'), '1.2.3');
  assert.equal(header(result.init, 'Accept-Language'), 'en');
});

test('/uploads/* (avatars) also goes to the server', () => {
  const result = rewriteRequest('/uploads/avatars/u1.webp?t=5', undefined, ctx);
  assert.equal(result.isApi, true);
  assert.equal(result.url, 'https://api.example.test/uploads/avatars/u1.webp?t=5');
});

test('headers set by the caller are kept; credentials: include becomes omit', () => {
  const result = rewriteRequest(
    '/api/profile',
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, credentials: 'include' },
    ctx,
  );
  assert.equal(header(result.init, 'Content-Type'), 'application/json');
  assert.equal(header(result.init, 'X-Client'), 'native');
  assert.equal(result.init.credentials, 'omit');
});

test('without a token there is no Authorization header (sign-in, registration)', () => {
  const result = rewriteRequest('/api/login', { method: 'POST' }, { ...ctx, token: null });
  assert.equal(result.isApi, true);
  assert.equal(header(result.init, 'Authorization'), null);
  assert.equal(header(result.init, 'X-Client'), 'native');
});

test('a URL object and an already absolute server address are recognised', () => {
  const fromUrl = rewriteRequest(new URL('https://api.example.test/api/me'), undefined, ctx);
  assert.equal(fromUrl.isApi, true);
  assert.equal(fromUrl.url, 'https://api.example.test/api/me');
  assert.equal(header(fromUrl.init, 'Authorization'), `Bearer ${TOKEN}`);
});

test('trailing slash of the server address does not double', () => {
  const result = rewriteRequest('/api/me', undefined, { ...ctx, apiBase: 'https://api.example.test/' });
  assert.equal(result.url, 'https://api.example.test/api/me');
});

test('bundle paths and foreign addresses are not touched', () => {
  for (const url of ['/icons/icon-192.png', '/audio/program-start.mp3', '/_next/static/chunk.js', '/apix', 'https://t.me/bot', 'https://evil.test/api/me']) {
    const init = { method: 'GET' };
    const result = rewriteRequest(url, init, ctx);
    assert.equal(result.isApi, false, url);
    assert.equal(result.url, url);
    assert.equal(header(result.init, 'Authorization'), null, url);
    assert.equal(header(result.init, 'X-Client'), null, url);
  }
});

test('a Request object keeps its method and headers', () => {
  const request = new Request('https://localhost/api/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
  const result = rewriteRequest(request, undefined, ctx);
  assert.equal(result.isApi, true);
  assert.equal(result.url, 'https://api.example.test/api/feedback');
  assert.equal(result.init.method, 'POST');
  assert.equal(header(result.init, 'Content-Type'), 'application/json');
  assert.equal(header(result.init, 'Authorization'), `Bearer ${TOKEN}`);
});
