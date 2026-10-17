/**
 * Сетевой мост приложения: одна обёртка над `window.fetch` вместо правки ~130 мест с
 * `fetch('/api/...')`. Интерфейс лежит в бандле (origin `capacitor://localhost` / `https://localhost`),
 * а API — на сервере: `/api/*` и `/uploads/*` переписываются на адрес сервера, к ним добавляются
 * `Authorization: Bearer`, `X-Client: native`, `X-App-Version`, `Accept-Language`; cookie не
 * отправляются. Пути бандла (`/icons`, `/audio`, `/_next`) и чужие адреса не трогаются.
 */

export type NativeFetchContext = { apiBase: string; token: string | null; appVersion: string; locale: string };

/** Origin'ы страницы приложения (Capacitor): запрос по полному адресу бандла — тоже «свой». */
const APP_ORIGINS = ['capacitor://localhost', 'https://localhost'];
const SERVER_PREFIXES = ['/api/', '/uploads/'];

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function inputUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function isServerPath(path: string): boolean {
  return SERVER_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** Путь сервера (`/api/...`, `/uploads/...`) с query, если адрес ведёт на API; иначе `null`. */
function serverPath(url: string, apiBase: string): string | null {
  if (url.startsWith('/') && !url.startsWith('//')) return isServerPath(url) ? url : null;
  if (apiBase && url.startsWith(`${apiBase}/`)) {
    const rest = url.slice(apiBase.length);
    return isServerPath(rest) ? rest : null;
  }
  const lower = url.toLowerCase();
  for (const origin of APP_ORIGINS) {
    if (lower.startsWith(`${origin}/`)) {
      const rest = url.slice(origin.length);
      return isServerPath(rest) ? rest : null;
    }
  }
  return null;
}

/** Заголовки запроса как плоский объект (ключи в нижнем регистре) — их же берёт фоновая отправка. */
function mergedHeaders(input: RequestInfo | URL, init: RequestInit | undefined): Headers {
  const headers = new Headers(typeof input === 'object' && !(input instanceof URL) ? input.headers : undefined);
  new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function headersRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export function rewriteRequest(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  ctx: NativeFetchContext,
): { url: string; init: RequestInit; isApi: boolean } {
  const url = inputUrl(input);
  const apiBase = trimTrailingSlash(ctx.apiBase);
  const path = serverPath(url, apiBase);
  if (path === null) return { url, init: { ...init }, isApi: false };

  const headers = mergedHeaders(input, init);
  if (ctx.token && !headers.has('authorization')) headers.set('authorization', `Bearer ${ctx.token}`);
  headers.set('x-client', 'native');
  if (ctx.appVersion) headers.set('x-app-version', ctx.appVersion);
  if (ctx.locale && !headers.has('accept-language')) headers.set('accept-language', ctx.locale);

  const method = init?.method ?? (typeof input === 'object' && !(input instanceof URL) ? input.method : undefined);
  return {
    url: `${apiBase}${path}`,
    init: { ...init, ...(method ? { method } : {}), headers: headersRecord(headers), credentials: 'omit' },
    isApi: true,
  };
}

let installed = false;

function isLoginPath(url: string): boolean {
  try {
    return new URL(url).pathname === '/api/login';
  } catch {
    return false;
  }
}

/**
 * Ставит обёртку над `window.fetch` (один раз). 401 от API (кроме `/api/login`, где это
 * «неверный пароль») — сессия истекла или отозвана: `onUnauthorized`.
 */
export function installNativeFetch(deps: {
  getContext(): NativeFetchContext;
  onUnauthorized(): void;
  /** Сервер ответил (`true`) или не ответил вовсе — нет сети или сервер недоступен (`false`). */
  onReachability?(reachable: boolean): void;
}): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const ctx = deps.getContext();
    const rewritten = rewriteRequest(input, init, ctx);
    if (!rewritten.isApi) return originalFetch(input, init);

    // У Request тело читается только из него самого: новый Request на адрес сервера.
    let response: Response;
    try {
      response = typeof input === 'object' && !(input instanceof URL)
        ? await originalFetch(new Request(rewritten.url, input), rewritten.init)
        : await originalFetch(rewritten.url, rewritten.init);
    } catch (error) {
      // Отмена запроса (AbortController) — не признак отсутствия связи.
      if (!(error instanceof DOMException && error.name === 'AbortError')) deps.onReachability?.(false);
      throw error;
    }
    deps.onReachability?.(true);

    // Ответ на запрос со старым токеном (вход случился, пока он шёл) новый вход не сбрасывает.
    if (response.status === 401 && !isLoginPath(rewritten.url) && deps.getContext().token === ctx.token) {
      try {
        deps.onUnauthorized();
      } catch {}
    }
    return response;
  };
}
