'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/provider';
import { uiKitMessages } from '@/i18n/messages/features/ui-kit';
import { pushLayer } from './layers';
import styles from './ui.module.css';

/** Уже этого экрана пояснение показывается листом снизу, шире — у кнопки. */
const SHEET_BELOW_WIDTH = 640;
const GAP = 8;
const EDGE = 12;

export type InfoButtonProps = {
  /** Заголовок пояснения; он же — подпись кнопки для чтения с экрана. */
  title?: string;
  children: ReactNode;
  /** Подпись кнопки вместо «Пояснение: <title>». */
  label?: string;
  className?: string;
};

/** Нижний край закреплённой шапки: пояснение не должно под неё уходить. */
function headerBottom(): number {
  const header = document.querySelector('.app-header');
  return header ? Math.max(0, header.getBoundingClientRect().bottom) : 0;
}

/**
 * Кнопка «i» (зона нажатия 44 px) с пояснением. Пояснение открывается у кнопки (на узком
 * экране — листом снизу), лежит выше шапки и закрывается тапом вне, Escape, повторным
 * нажатием и крестиком. Ошибки, пустые состояния и предупреждения о необратимом сюда не прячут.
 */
export default function InfoButton({ title, children, label, className }: InfoButtonProps) {
  const { locale } = useI18n();
  const text = uiKitMessages[locale];
  const popoverId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [asSheet, setAsSheet] = useState(false);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  /** Ставит пояснение у кнопки; `false` — кнопка уехала под шапку или за экран. */
  const place = useCallback((): boolean => {
    const button = buttonRef.current;
    const popover = popoverRef.current;
    if (!button || !popover || asSheet) return true;
    const rect = button.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const top = headerBottom() + GAP;
    if (rect.bottom < top - GAP || rect.top > viewportHeight) return false;
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;
    const left = Math.min(Math.max(EDGE, rect.left + rect.width / 2 - width / 2), viewportWidth - width - EDGE);
    const below = rect.bottom + GAP;
    const above = rect.top - GAP - height;
    const fitsBelow = below + height <= viewportHeight - EDGE;
    const y = fitsBelow || above < top ? Math.max(top, Math.min(below, viewportHeight - EDGE - height)) : above;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(Math.max(top, y))}px`;
    popover.style.visibility = 'visible';
    return true;
  }, [asSheet]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const layer = pushLayer(() => close(true));
    popoverRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null;
      if (!target || popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return;
      if (layer.isTop()) close(false);
    };
    const onMove = () => {
      // Кнопка ушла с экрана — пояснение больше не к чему привязать.
      if (!place()) close(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      layer.remove();
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open, close, place]);

  const buttonLabel = label ?? (title ? text.infoAbout.replace('{title}', title) : text.info);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.infoButton} ${className ?? ''}`}
        aria-label={buttonLabel}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-haspopup="dialog"
        onClick={(event) => {
          // Кнопка бывает внутри <summary>, <label> или кликабельной строки — их не трогаем.
          event.preventDefault();
          event.stopPropagation();
          if (open) {
            close(false);
            return;
          }
          setAsSheet(window.innerWidth < SHEET_BELOW_WIDTH);
          setOpen(true);
        }}
      >
        <span className={styles.infoDot} aria-hidden="true">
          i
        </span>
      </button>
      {open && typeof document !== 'undefined'
        ? createPortal(
            <div
              ref={popoverRef}
              id={popoverId}
              role="dialog"
              aria-label={title ?? text.info}
              tabIndex={-1}
              className={`${styles.popover} ${asSheet ? `${styles.popoverSheet} ui-sheet-up` : 'ui-fade-in'}`}
              style={asSheet ? undefined : { visibility: 'hidden', top: 0, left: 0 }}
              // Портал всплывает по дереву React: клик внутри не должен доходить до строки/формы под кнопкой.
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className={styles.popoverHead}>
                {title ? <div className={styles.popoverTitle}>{title}</div> : <div className={styles.popoverTitle} aria-hidden="true" />}
                <button type="button" className={styles.popoverClose} aria-label={text.close} onClick={() => close(true)}>
                  ✕
                </button>
              </div>
              <div className={styles.popoverBody}>{children}</div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
