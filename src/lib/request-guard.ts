/**
 * Pure checks applied by `src/proxy.ts` to every `/api/*` request before a route runs:
 * - CSRF: unsafe methods must come from our own origin (`Origin`, else `Referer`);
 * - Content-Type: only JSON (plus multipart on the avatar uploads), so a same-site page
 *   cannot post a CORS-free `text/plain` or form body with the session cookie;
 * - body size by `Content-Length`, before anything reads the body.
 */

export const JSON_BODY_LIMIT_BYTES = 64 * 1024;
export const MULTIPART_BODY_LIMIT_BYTES = 5 * 1024 * 1024;

/** Endpoints that accept `multipart/form-data` (avatar uploads). */
export const MULTIPART_API_PATHS: readonly string[] = ['/api/profile/avatar', '/api/admin/users/avatar'];

/** Server-to-server endpoints: no browser Origin, authenticated by their own secret. */
export const ORIGIN_EXEMPT_API_PATHS: readonly string[] = ['/api/telegram/webhook'];

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export type GuardFailureCode = 'FORBIDDEN_ORIGIN' | 'UNSUPPORTED_CONTENT_TYPE' | 'PAYLOAD_TOO_LARGE';

export type GuardVerdict =
  | { ok: true }
  | { ok: false; status: 403 | 413 | 415; code: GuardFailureCode };

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

  if (!originExempt) {
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
  const limit = isMultipart && multipartAllowed ? MULTIPART_BODY_LIMIT_BYTES : JSON_BODY_LIMIT_BYTES;
  if (length !== null && length > limit) return PAYLOAD_TOO_LARGE;

  return { ok: true };
}

const GUARD_MESSAGES: Record<GuardFailureCode, { ru: string; en: string }> = {
  FORBIDDEN_ORIGIN: { ru: 'Запрос с чужого сайта отклонён', en: 'Cross-site request rejected' },
  UNSUPPORTED_CONTENT_TYPE: { ru: 'Неподдерживаемый формат запроса', en: 'Unsupported request format' },
  PAYLOAD_TOO_LARGE: { ru: 'Слишком большой запрос', en: 'Request is too large' },
};

/** JSON body for a rejected request, in the project's `{ error, code }` shape. */
export function guardErrorBody(code: GuardFailureCode, locale: string = 'ru'): { error: string; code: GuardFailureCode } {
  const messages = GUARD_MESSAGES[code];
  return { error: locale === 'en' ? messages.en : messages.ru, code };
}
