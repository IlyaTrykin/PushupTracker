import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
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

// --- Invariant (ADR-0015, 0016, 0023): CORS is granted in exactly one place ---

const ROOT = path.resolve(__dirname, '..', '..');
/** The only files allowed to grant CORS: the header table and the proxy that applies it. */
const CORS_OWNERS = new Set(['src/lib/cors.ts', 'src/proxy.ts']);
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?)$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(full);
    // Tests talk about the header; `*.bak*` copies are local junk ignored by git.
    if (!SOURCE_FILE.test(name) || /\.test\.[jt]sx?$/.test(name) || name.includes('.bak')) return [];
    return [full];
  });
}

/** Server code and configs that could put a header on a response: `src/**` and the root configs. */
function filesThatCouldSetHeaders(): string[] {
  const rootConfigs = readdirSync(ROOT)
    .filter((name) => SOURCE_FILE.test(name) && statSync(path.join(ROOT, name)).isFile())
    .map((name) => path.join(ROOT, name));
  return [...sourceFiles(path.join(ROOT, 'src')), ...rootConfigs];
}

test('Access-Control-Allow-* is set only by src/lib/cors.ts and src/proxy.ts (the CSRF exemption relies on it)', () => {
  const offenders = filesThatCouldSetHeaders()
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .filter((file) => !CORS_OWNERS.has(file))
    .filter((file) => /access-control-allow-/i.test(readFileSync(path.join(ROOT, file), 'utf8')));
  assert.deepEqual(offenders, [], 'only cors.ts / proxy.ts may grant CORS: a route answering a foreign origin turns off CSRF protection of Bearer and X-Client: native requests');
});

test('the invariant scan sees the code it guards', () => {
  const files = filesThatCouldSetHeaders().map((file) => path.relative(ROOT, file).split(path.sep).join('/'));
  for (const expected of ['src/lib/cors.ts', 'src/proxy.ts', 'src/app/api/workouts/route.ts', 'next.config.ts']) {
    assert.ok(files.includes(expected), expected);
  }
});
