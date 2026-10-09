// Ограничения для web-push подписок (S09): сервер сам шлёт POST на endpoint из подписки,
// поэтому принимаем только https-адреса настоящих push-сервисов браузеров — иначе
// подписка превращается в способ стучаться во внутреннюю сеть.

export const MAX_PUSH_SUBSCRIPTIONS_PER_USER = 10;
export const MAX_PUSH_ENDPOINT_LENGTH = 1024;
const MAX_PUSH_KEY_LENGTH = 256;

// Точные хосты и суффиксы (суффикс начинается с точки, чтобы не пропускать evilpush.services.mozilla.com).
const EXACT_HOSTS = new Set(['fcm.googleapis.com', 'android.googleapis.com', 'web.push.apple.com']);
const HOST_SUFFIXES = ['.push.services.mozilla.com', '.notify.windows.com', '.push.apple.com'];

export function isAllowedPushEndpoint(raw: unknown): boolean {
  if (typeof raw !== 'string') return false;
  if (!raw || raw.length > MAX_PUSH_ENDPOINT_LENGTH) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  if (url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;

  const host = url.hostname.toLowerCase();
  if (EXACT_HOSTS.has(host)) return true;
  return HOST_SUFFIXES.some((suffix) => host.endsWith(suffix) && host.length > suffix.length);
}

// Ключи подписки (p256dh, auth) — base64/base64url, короткие.
export function isValidPushKey(raw: unknown): boolean {
  return typeof raw === 'string' && raw.length > 0 && raw.length <= MAX_PUSH_KEY_LENGTH && /^[A-Za-z0-9_\-+/]+=*$/.test(raw);
}

// Какие подписки пользователя удалить, чтобы осталось не больше `limit`: самые давние по updatedAt.
export function subscriptionsToEvict(
  subs: Array<{ id: string; updatedAt: Date }>,
  limit = MAX_PUSH_SUBSCRIPTIONS_PER_USER,
): string[] {
  if (subs.length <= limit) return [];
  const newestFirst = [...subs].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  return newestFirst.slice(limit).map((sub) => sub.id);
}
