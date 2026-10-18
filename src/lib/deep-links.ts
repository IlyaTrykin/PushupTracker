/**
 * Входящие ссылки приложения (App Links на Android, universal links на iPhone) и файлы
 * `/.well-known/*`, которые их подтверждают. Чистые функции: хост сервера и идентификаторы
 * подписи приходят из env, в git их нет.
 */

const DEFAULT_APP_ID = 'app.pushuptracker.mobile';
const CODE_RE = /^[A-Za-z0-9_-]{1,128}$/;
const FINGERPRINT_RE = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;
const TEAM_ID_RE = /^[A-Z0-9]{10}$/;

/** `host[:port]` адреса сервера; не адрес — null. */
export function hostOf(base: string | null | undefined): string | null {
  if (!base) return null;
  try {
    const url = new URL(base);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.host || null;
  } catch {
    return null;
  }
}

/**
 * Входящий URL → маршрут приложения. Только хост сервера (`ownHost`) и только известные пути:
 * `/invite/<code>` → `/register?invite=`, `/groups?invite=`, `/reset-password?token=`.
 * Остальное — null (ссылка игнорируется).
 */
export function resolveDeepLink(rawUrl: string, ownHost: string | null): string | null {
  if (!ownHost) return null;
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.host.toLowerCase() !== ownHost.toLowerCase()) return null;

  const path = url.pathname.replace(/\/+$/, '');
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) {
    const code = invite[1];
    return CODE_RE.test(code) ? `/register?invite=${encodeURIComponent(code)}` : null;
  }
  if (path === '/groups') {
    const code = url.searchParams.get('invite');
    return code && CODE_RE.test(code) ? `/groups?invite=${encodeURIComponent(code)}` : null;
  }
  if (path === '/reset-password') {
    const token = url.searchParams.get('token');
    return token && CODE_RE.test(token) ? `/reset-password?token=${encodeURIComponent(token)}` : null;
  }
  return null;
}

type AssetLinksEnv = Readonly<Record<string, string | undefined>>;

/** Содержимое `/.well-known/assetlinks.json`; без отпечатка сертификата — null (ответ 404). */
export function buildAssetLinks(env: AssetLinksEnv) {
  const fingerprints = (env.ANDROID_CERT_SHA256 || '')
    .split(',')
    .map((item) => item.trim().toUpperCase())
    .filter((item) => FINGERPRINT_RE.test(item));
  if (fingerprints.length === 0) return null;
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: (env.ANDROID_APP_PACKAGE || '').trim() || DEFAULT_APP_ID,
        sha256_cert_fingerprints: fingerprints,
      },
    },
  ];
}

type AppleEnv = Readonly<Record<string, string | undefined>>;

/** Содержимое `/.well-known/apple-app-site-association`; без Team ID — null (ответ 404). */
export function buildAppleAppSiteAssociation(env: AppleEnv) {
  const teamId = (env.APPLE_TEAM_ID || '').trim();
  if (!TEAM_ID_RE.test(teamId)) return null;
  const bundleId = (env.APPLE_BUNDLE_ID || '').trim() || DEFAULT_APP_ID;
  return {
    applinks: {
      details: [
        {
          appIDs: [`${teamId}.${bundleId}`],
          components: [
            { '/': '/invite/*' },
            { '/': '/groups', '?': { invite: '*' } },
            { '/': '/reset-password', '?': { token: '*' } },
          ],
        },
      ],
    },
  };
}
