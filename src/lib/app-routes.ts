/**
 * Адреса экранов с идентификатором. На сайте — прежние пути с сегментами (`/groups/<id>`),
 * в приложении (статический экспорт не знает id заранее) — параметры запроса
 * (`/groups/view?id=`). Все ссылки на группы, соревнования, программы и сессии строятся
 * только здесь; `Notification.link` с сервера переводится `toAppRoute` при открытии.
 */
import { isNativeApp } from './platform';

export type RouteTarget = 'web' | 'native';
export type GroupTab = 'challenges' | 'manage' | 'members';

const GROUP_TABS: readonly GroupTab[] = ['challenges', 'manage', 'members'];

function resolveTarget(target?: RouteTarget): RouteTarget {
  return target ?? (isNativeApp() ? 'native' : 'web');
}

function seg(value: string): string {
  return encodeURIComponent(value);
}

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, value);
  }
  return search.toString();
}

export function groupHref(id: string, tab?: GroupTab, target?: RouteTarget): string {
  if (resolveTarget(target) === 'native') return `/groups/view?${query({ id, tab })}`;
  return tab ? `/groups/${seg(id)}/${tab}` : `/groups/${seg(id)}`;
}

export function groupMemberHref(groupId: string, userId: string, target?: RouteTarget): string {
  if (resolveTarget(target) === 'native') return `/groups/member?${query({ id: groupId, userId })}`;
  return `/groups/${seg(groupId)}/members/${seg(userId)}`;
}

export function challengeHref(id: string, target?: RouteTarget): string {
  if (resolveTarget(target) === 'native') return `/challenges/view?${query({ id })}`;
  return `/challenges/${seg(id)}`;
}

export function programHref(id: string, target?: RouteTarget): string {
  if (resolveTarget(target) === 'native') return `/program/view?${query({ id })}`;
  return `/program/${seg(id)}`;
}

export function programSessionHref(id: string, target?: RouteTarget): string {
  if (resolveTarget(target) === 'native') return `/program/session?${query({ id })}`;
  return `/program/session/${seg(id)}`;
}

/** Дописывает параметры к адресу, в котором `?` уже может быть (адреса приложения). */
export function appendQuery(href: string, extra: string | URLSearchParams): string {
  const text = typeof extra === 'string' ? extra.replace(/^[?&]/, '') : extra.toString();
  if (!text) return href;
  return `${href}${href.includes('?') ? '&' : '?'}${text}`;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function nativePathFor(segments: string[]): string | null {
  const [section, a, b, c, ...rest] = segments;
  if (rest.length > 0) return null;
  if (section === 'challenges' && a && a !== 'view' && b === undefined) return challengeHref(safeDecode(a), 'native');
  if (section === 'program' && a === 'session' && b && c === undefined) return programSessionHref(safeDecode(b), 'native');
  if (section === 'program' && a && a !== 'view' && a !== 'session' && b === undefined) return programHref(safeDecode(a), 'native');
  if (section === 'groups' && a && a !== 'view' && a !== 'member') {
    const id = safeDecode(a);
    if (b === undefined) return groupHref(id, undefined, 'native');
    if (b === 'members' && c) return groupMemberHref(id, safeDecode(c), 'native');
    if (c === undefined && (GROUP_TABS as readonly string[]).includes(b)) return groupHref(id, b as GroupTab, 'native');
  }
  return null;
}

/** '/challenges/abc?x=1' → '/challenges/view?id=abc&x=1'; неизвестное — как есть. */
export function toAppRoute(webPath: string): string {
  if (!webPath || !webPath.startsWith('/') || webPath.startsWith('//')) return webPath;
  const hashIndex = webPath.indexOf('#');
  const hash = hashIndex >= 0 ? webPath.slice(hashIndex) : '';
  const beforeHash = hashIndex >= 0 ? webPath.slice(0, hashIndex) : webPath;
  const queryIndex = beforeHash.indexOf('?');
  const search = queryIndex >= 0 ? beforeHash.slice(queryIndex + 1) : '';
  const pathname = queryIndex >= 0 ? beforeHash.slice(0, queryIndex) : beforeHash;
  const segments = pathname.split('/').filter(Boolean);
  const native = nativePathFor(segments);
  if (!native) return webPath;
  return `${appendQuery(native, search)}${hash}`;
}

/** Ссылка с сервера (`Notification.link`, пуш): на сайте — как есть, в приложении — маршрут приложения. */
export function linkHref(link: string, target?: RouteTarget): string {
  return resolveTarget(target) === 'native' ? toAppRoute(link) : link;
}
