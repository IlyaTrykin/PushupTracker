'use client';

import { useParams, useSearchParams } from 'next/navigation';
import { isNativeApp } from './platform';

export type RouteParamName = 'id' | 'userId';

function useWebRouteParam(name: RouteParamName): string | null {
  const params = useParams<Record<string, string | string[] | undefined>>();
  const value = params?.[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first ? String(first) : null;
}

function useNativeRouteParam(name: RouteParamName): string | null {
  const searchParams = useSearchParams();
  return searchParams?.get(name) || null;
}

// Сборка либо сайт, либо приложение: выбор делается один раз, порядок хуков стабилен.
const readRouteParam = isNativeApp() ? useNativeRouteParam : useWebRouteParam;

/** Id экрана: на сайте — из сегмента пути (`/groups/[id]`), в приложении — из `?id=`. */
export function useRouteParam(name: RouteParamName): string | null {
  return readRouteParam(name);
}
