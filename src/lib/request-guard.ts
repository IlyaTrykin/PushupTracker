/**
 * Pure checks applied by `src/proxy.ts` to every `/api/*` request before a route runs:
 * - CSRF: unsafe methods must come from our own origin (`Origin`, else `Referer`) — unless the
 *   request carries no `session` cookie and is the native app's (`Authorization: Bearer` or
 *   `X-Client: native` — sign-in, registration before there is a token): CSRF rides on a cookie the
 *   browser attaches by itself, and both headers force a CORS preflight only app origins pass;
 * - Content-Type: only JSON (plus multipart on the avatar uploads), so a same-site page
 *   cannot post a CORS-free `text/plain` or form body with the session cookie;
 * - body size by `Content-Length`, before anything reads the body; a JSON body streamed
 *   without it (chunked) is refused with 411, since its size cannot be checked up front.
 */

export const JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const MULTIPART_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

/** Endpoints that accept `multipart/form-data` (avatar uploads). */
export const MULTIPART_API_PATHS: readonly string[] = ['/api/profile/avatar', '/api/admin/users/avatar'];

/** Server-to-server endpoints: no browser Origin, authenticated by their own secret. */
export const ORIGIN_EXEMPT_API_PATHS: readonly string[] = ['/api/telegram/webhook'];

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type GuardFailureCode = 'FORBIDDEN_ORIGIN' | 'UNSUPPORTED_CONTENT_TYPE' | 'PAYLOAD_TOO_LARGE' | 'LENGTH_REQUIRED';

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 411 | 413 | 415; code: GuardFailureCode };

export type ApiRequestMeta = {
  method: string;
  pathname: string;
  headers: { get(name: string): string | null };
  /** `APP_URL` — the public address of the app; optional (local dev). */
  appUrl?: string | null;
};

const FORBIDDEN_ORIGIN: GuardVerdict = { ok: false, status: 403, code: 'FORBIDDEN_ORIGIN' };
const UNSUPPORTED_CONTENT_TYPE: GuardVerdict = { ok: false, status: 415, code: 'UNSUPPORTED_CONTENT_TYPE' };
const PAYLOAD_TOO_LARGE: GuardVerdict = { ok: false, status: 413, code: 'PAYLOAD_TOO_LARGE' };
const LENGTH_REQUIRED: GuardVerdict = { ok: false, status: 411, code: 'LENGTH_REQUIRED' };

function parseUrl(raw: string | null | undefined): URL | null {
  if (!raw) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function firstHeaderValue(raw: string | null): string | null {
  const value = raw?.split(',')[0]?.trim().toLowerCase();
  return value || null;
}

/** Origin of the request initiator: `Origin`, or the origin part of `Referer`. */
function requestSourceOrigin(headers: ApiRequestMeta['headers']): URL | null {
  const origin = headers.get('origin');
  if (origin !== null) return parseUrl(origin); // "null" and garbage → null → rejected
  return parseUrl(headers.get('referer'));
}

function isOwnOrigin(source: URL, meta: ApiRequestMeta): boolean {
  if (source.protocol !== 'https:' && source.protocol !== 'http:') return false;

  const app = parseUrl(meta.appUrl);
  if (app && app.origin === source.origin) return true;

  // Same host as the request itself (dev server, a direct hit on the container).
  // The scheme is not compared: TLS is terminated by the reverse proxy.
  const hosts = [firstHeaderValue(meta.headers.get('host')), firstHeaderValue(meta.headers.get('x-forwarded-host'))];
  return hosts.includes(source.host.toLowerCase());
}

const BEARER_PATTERN = /^Bearer ([0-9a-f]{64})$/;

/** Session token from `Authorization: Bearer <64 lowercase hex>`; anything else → null. */
export function parseBearerToken(header: string | null | undefined): string | null {
  const match = header?.trim().match(BEARER_PATTERN);
  return match ? match[1] : null;
}

/** `X-Client: native` — the marker the native app puts on every API request. */
export function isNativeClientHeader(value: string | null | undefined): boolean {
  return value?.trim().toLowerCase() === 'native';
}

function hasSessionCookie(cookieHeader: string | null): boolean {
  return /(?:^|;\s*)session=[^;\s]/.test(cookieHeader ?? '');
}

/** Native-app request with no session cookie to ride on: a well-formed Bearer token or `X-Client: native`. */
function isCookielessAppRequest(headers: ApiRequestMeta['headers']): boolean {
  if (hasSessionCookie(headers.get('cookie'))) return false;
  if (parseBearerToken(headers.get('authorization')) !== null) return true;
  return isNativeClientHeader(headers.get('x-client'));
}

function mediaType(raw: string | null): string | null {
  const value = raw?.split(';')[0]?.trim().toLowerCase();
  return value || null;
}

function contentLength(raw: string | null): number | null {
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  return Number(raw.trim());
}

function hasBody(headers: ApiRequestMeta['headers']): boolean {
  const length = contentLength(headers.get('content-length'));
  if (length !== null) return length > 0;
  return headers.get('transfer-encoding') !== null;
}

export function checkApiRequest(meta: ApiRequestMeta): GuardVerdict {
  const method = meta.method.toUpperCase();
  if (!UNSAFE_METHODS.has(method)) return { ok: true };

  const { headers, pathname } = meta;
  const originExempt = ORIGIN_EXEMPT_API_PATHS.includes(pathname);

  if (!originExempt && !isCookielessAppRequest(headers)) {
    const source = requestSourceOrigin(headers);
    if (!source || !isOwnOrigin(source, meta)) return FORBIDDEN_ORIGIN;
  }

  const type = mediaType(headers.get('content-type'));
  const multipartAllowed = MULTIPART_API_PATHS.includes(pathname);
  const isMultipart = type === 'multipart/form-data';

  if (!originExempt) {
    if (type === null) {
      if (hasBody(headers)) return UNSUPPORTED_CONTENT_TYPE;
    } else if (type !== 'application/json' && !(isMultipart && multipartAllowed)) {
      return UNSUPPORTED_CONTENT_TYPE;
    }
  }

  const length = contentLength(headers.get('content-length'));
  // A body without Content-Length (Transfer-Encoding: chunked) would dodge the size limit.
  // Exempt: the Telegram webhook and avatar multipart — Next buffers at most 10 MB of a body
  // behind the proxy (`proxyClientMaxBodySize`), and the avatar routes check the file size.
  const streamed = length === null && headers.get('transfer-encoding') !== null;
  if (streamed && !originExempt && !(isMultipart && multipartAllowed)) return LENGTH_REQUIRED;

  const limit = isMultipart && multipartAllowed ? MULTIPART_BODY_LIMIT_BYTES : JSON_BODY_LIMIT_BYTES;
  if (length !== null && length > limit) return PAYLOAD_TOO_LARGE;

  return { ok: true };
}

const GUARD_MESSAGES: Record<GuardFailureCode, { ru: string; en: string }> = {
  FORBIDDEN_ORIGIN: { ru: 'Запрос с чужого сайта отклонён', en: 'Cross-site request rejected' },
  UNSUPPORTED_CONTENT_TYPE: { ru: 'Неподдерживаемый формат запроса', en: 'Unsupported request format' },
  PAYLOAD_TOO_LARGE: { ru: 'Слишком большой запрос', en: 'Request is too large' },
  LENGTH_REQUIRED: { ru: 'Нужен заголовок Content-Length', en: 'Content-Length header is required' },
};

/** JSON body for a rejected request, in the project's `{ error, code }` shape. */
export function guardErrorBody(code: GuardFailureCode, locale: string = 'ru'): { error: string; code: GuardFailureCode } {
  const messages = GUARD_MESSAGES[code];
  return { error: locale === 'en' ? messages.en : messages.ru, code };
}
