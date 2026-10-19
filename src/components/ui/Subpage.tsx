'use client';

import { useCallback, useLayoutEffect, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/provider';
import { uiKitMessages } from '@/i18n/messages/features/ui-kit';
import styles from './ui.module.css';

/**
 * Уровни внутри одной страницы через параметр адреса (`?section=health`): открыть уровень —
 * новая запись истории (`history.pushState`, Next синхронизирует `useSearchParams`), назад —
 * `history.back()`. Поэтому браузерная «назад», жест и аппаратная кнопка Android
 * (`layout.native.tsx` листает историю) закрывают уровень, а не уводят со страницы.
 * Новых маршрутов и `page.native.tsx` не нужно. Компонент со `useSearchParams` должен быть
 * внутри `<Suspense>` (страницы приложения уже обёрнуты, см. `page.native.tsx`).
 */

/** Адреса, которые открыла сама страница: «назад» с них — шаг истории, иначе — замена адреса. */
const pushedUrls = new Set<string>();
/** Прокрутка уровня перед уходом глубже — вернуть её при возврате. */
const scrollByUrl = new Map<string, number>();

function hereUrl(): string {
  return `${window.location.pathname}${window.location.search}`;
}

function urlWith(param: string, value: string | null): string {
  const params = new URLSearchParams(window.location.search);
  if (value === null) params.delete(param);
  else params.set(param, value);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}`;
}

/**
 * Шаг «назад» с уровня `?<param>=…` текущего адреса: если уровень открыла сама страница —
 * шаг истории, иначе (прямая ссылка) — адрес без параметра. `false` — уровня в адресе нет.
 * Используется кнопкой «‹ Назад» и аппаратной «назад» Android (в т. ч. на /dashboard).
 */
export function backFromSubpage(param = 'section'): boolean {
  if (!new URLSearchParams(window.location.search).get(param)) return false;
  const here = hereUrl();
  if (pushedUrls.has(here)) {
    pushedUrls.delete(here);
    window.history.back();
    return true;
  }
  window.history.replaceState(null, '', urlWith(param, null));
  return true;
}

export type SubpageDirection = 'forward' | 'back' | 'none';

export type SubpageControls = {
  /** Открытый уровень (значение параметра) или `null` — корень страницы. */
  current: string | null;
  open: (id: string) => void;
  back: () => void;
  /** Куда сдвинулись последний раз — для анимации въезда. */
  direction: SubpageDirection;
};

export function useSubpage(param = 'section'): SubpageControls {
  const searchParams = useSearchParams();
  const current = searchParams.get(param) || null;
  const [seen, setSeen] = useState(current);
  const [direction, setDirection] = useState<SubpageDirection>('none');
  // Направление считается при смене уровня (как бы она ни случилась: кнопкой, историей, ссылкой).
  if (seen !== current) {
    setSeen(current);
    setDirection(current === null ? 'back' : 'forward');
  }

  const open = useCallback(
    (id: string) => {
      const from = hereUrl();
      const to = urlWith(param, id);
      if (to === from) return;
      scrollByUrl.set(from, window.scrollY);
      pushedUrls.add(to);
      window.history.pushState(null, '', to);
    },
    [param],
  );

  const back = useCallback(() => {
    backFromSubpage(param);
  }, [param]);

  return { current, open, back, direction };
}

export type SubpageDef = {
  title: ReactNode;
  /** Содержимое уровня; функция вызывается, только когда уровень открыт. */
  content: ReactNode | (() => ReactNode);
};

/**
 * Корень страницы или открытый уровень с шапкой «‹ Назад» + заголовок. Уровень въезжает
 * справа, при возврате корень въезжает слева (`ui-slide-in` / `ui-slide-back` в globals.css,
 * отключаются при «уменьшить движение»). Неизвестное значение параметра — показывается корень.
 */
export function SubpageStack({
  param = 'section',
  root,
  pages,
  className,
}: {
  param?: string;
  root: ReactNode;
  pages: Record<string, SubpageDef>;
  className?: string;
}) {
  const { current, back, direction } = useSubpage(param);
  const page = current && Object.prototype.hasOwnProperty.call(pages, current) ? pages[current] : null;
  const levelKey = page ? `level:${current}` : 'root';

  useLayoutEffect(() => {
    if (direction === 'forward') {
      window.scrollTo(0, 0);
      return;
    }
    if (direction === 'back') {
      const saved = scrollByUrl.get(hereUrl());
      if (saved !== undefined) window.scrollTo(0, saved);
    }
  }, [levelKey, direction]);

  if (!page) {
    return (
      <div key={levelKey} className={`${className ?? ''} ${direction === 'back' ? 'ui-slide-back' : ''}`}>
        {root}
      </div>
    );
  }

  return (
    <section key={levelKey} className={`${styles.level} ${className ?? ''} ${direction === 'forward' ? 'ui-slide-in' : ''}`}>
      <div className={styles.levelHead}>
        <BackButton onClick={back} />
        <h2 className={styles.levelTitle}>{page.title}</h2>
      </div>
      {typeof page.content === 'function' ? page.content() : page.content}
    </section>
  );
}

/** Есть ли куда вернуться внутри приложения/сайта (а не на чужую страницу или в пустоту). */
function canGoBackInApp(): boolean {
  const nav = (window as Window & { navigation?: { canGoBack?: boolean } }).navigation;
  if (nav && typeof nav.canGoBack === 'boolean') return nav.canGoBack;
  return window.history.length > 1;
}

/**
 * «‹ Назад» для уровня. С `onClick` — своё действие (закрыть уровень); без него —
 * шаг назад по истории, а если шага нет (открыли ссылкой) — переход на `fallbackHref`.
 */
export function BackButton({
  onClick,
  fallbackHref,
  label,
  className,
}: {
  onClick?: () => void;
  fallbackHref?: string;
  label?: string;
  className?: string;
}) {
  const { locale } = useI18n();
  const router = useRouter();
  const text = uiKitMessages[locale];
  return (
    <button
      type="button"
      className={`${styles.backButton} ${className ?? ''}`}
      onClick={() => {
        if (onClick) {
          onClick();
          return;
        }
        if (canGoBackInApp() || !fallbackHref) router.back();
        else router.replace(fallbackHref);
      }}
    >
      <span className={styles.backChevron} aria-hidden="true">
        ‹
      </span>
      {label ?? text.back}
    </button>
  );
}
