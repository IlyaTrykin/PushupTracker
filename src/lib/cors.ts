/**
 * CORS for the native app. Its WebView loads the bundled UI from its own origin
 * (`capacitor://localhost` on iOS, `https://localhost` on Android) and calls the API on
 * our host, authenticated by `Authorization: Bearer` — never by cookies, so no
 * `Access-Control-Allow-Credentials`. Applied by `src/proxy.ts` to `/api/*` and `/uploads/*`.
 */

export const DEFAULT_NATIVE_APP_ORIGINS: readonly string[] = ['capacitor://localhost', 'https://localhost'];

const ALLOW_METHODS = 'GET,POST,PUT,PATCH,DELETE,OPTIONS';
const ALLOW_HEADERS = 'Authorization, Content-Type, X-Client, X-App-Version, Accept-Language';
const MAX_AGE_SECONDS = '600';

/** `NATIVE_APP_ORIGINS` — comma-separated origins; empty → the app defaults. `*` is never honoured. */
export function parseAllowedOrigins(env: string | undefined): string[] {
  const origins = (env ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => value !== '');
  return origins.length > 0 ? origins : [...DEFAULT_NATIVE_APP_ORIGINS];
}

/** Response headers for a request from `origin`, or null when the origin is not allowed (exact match). */
export function corsHeaders(origin: string | null, allowed: string[]): Record<string, string> | null {
  if (!origin || origin === '*' || origin === 'null' || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Access-Control-Allow-Methods': ALLOW_METHODS,
    'Access-Control-Allow-Headers': ALLOW_HEADERS,
    'Access-Control-Max-Age': MAX_AGE_SECONDS,
  };
}
