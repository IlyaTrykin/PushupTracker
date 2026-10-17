import test from 'node:test';
import assert from 'node:assert/strict';
import { corsHeaders, parseAllowedOrigins } from './cors';

test('without NATIVE_APP_ORIGINS the app WebView origins are allowed', () => {
  assert.deepEqual(parseAllowedOrigins(undefined), ['capacitor://localhost', 'https://localhost']);
  assert.deepEqual(parseAllowedOrigins(''), ['capacitor://localhost', 'https://localhost']);
  assert.deepEqual(parseAllowedOrigins('  ,  '), ['capacitor://localhost', 'https://localhost']);
});

test('NATIVE_APP_ORIGINS is a comma list; blanks and trailing slashes are dropped', () => {
  assert.deepEqual(parseAllowedOrigins(' capacitor://localhost , http://localhost/ ,,'), [
    'capacitor://localhost',
    'http://localhost',
  ]);
});

test('an allowed origin gets the CORS headers echoed back, without credentials', () => {
  const allowed = ['capacitor://localhost', 'https://localhost'];
  for (const origin of allowed) {
    assert.deepEqual(corsHeaders(origin, allowed), {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Client, X-App-Version, Accept-Language',
      'Access-Control-Max-Age': '600',
      'Access-Control-Expose-Headers': 'Retry-After',
    });
  }
});

test('a foreign, missing or look-alike origin gets no CORS headers', () => {
  const allowed = ['capacitor://localhost', 'https://localhost'];
  for (const origin of [
    null,
    '',
    'null',
    'https://evil.example.net',
    'http://localhost',
    'https://localhost:8443',
    'https://localhost.evil.example.net',
    'capacitor://localhost/',
    '*',
  ]) {
    assert.equal(corsHeaders(origin, allowed), null, String(origin));
  }
});

test('a wildcard in the allow list never opens CORS to everyone', () => {
  assert.equal(corsHeaders('https://evil.example.net', parseAllowedOrigins('*')), null);
});

test('the app can read Retry-After of a 429 (exposed to the WebView)', () => {
  const headers = corsHeaders('capacitor://localhost', ['capacitor://localhost']);
  assert.equal(headers?.['Access-Control-Expose-Headers'], 'Retry-After');
});
