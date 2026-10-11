/** Public origin of the app (APP_URL), without a trailing slash; null when unset or not http(s). */
export function publicAppUrl(): string | null {
  const raw = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  return /^https?:\/\//.test(raw) ? raw : null;
}
