'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '@/i18n/provider';
import { uiKitMessages } from '@/i18n/messages/features/ui-kit';
import { lockPageScroll, pushLayer, trapTab } from './layers';
import styles from './ui.module.css';

export type SheetProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Закреплённая нижняя полоса (кнопки формы); прокручивается только середина. */
  footer?: ReactNode;
  /** Шире обычного (списки дня, таблицы). */
  wide?: boolean;
  /** Подпись окна для чтения с экрана, если `title` — не строка. */
  ariaLabel?: string;
  /** Подпись кнопки закрытия вместо «Закрыть». */
  closeLabel?: string;
  testId?: string;
};

/**
 * Окно/лист поверх всего, включая шапку. Верх окна всегда ниже шапки (с учётом выреза),
 * заголовок с «Закрыть» закреплён, содержимое прокручивается внутри — при любом числе
 * записей кнопку можно нажать. На узком экране — лист снизу, на широком — окно сверху.
 * Закрывается кнопкой, тапом по затемнению и Escape; фокус остаётся внутри до закрытия.
 */
export default function Sheet(props: SheetProps) {
  if (!props.open || typeof document === 'undefined') return null;
  return createPortal(<SheetPanel {...props} />, document.body);
}

function SheetPanel({ onClose, title, children, footer, wide, ariaLabel, closeLabel, testId }: SheetProps) {
  const { locale } = useI18n();
  const text = uiKitMessages[locale];
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const layerRef = useRef<ReturnType<typeof pushLayer> | null>(null);
  const pressedOnOverlay = useRef(false);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const layer = pushLayer(() => onCloseRef.current());
    layerRef.current = layer;
    const unlock = lockPageScroll();
    panelRef.current?.focus({ preventScroll: true });
    return () => {
      layer.remove();
      layerRef.current = null;
      unlock();
      if (previous && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className={`${styles.overlay} ui-fade-in`}
      role="presentation"
      onPointerDown={(event) => {
        // Закрывает только нажатие именно по затемнению и только если сверху нет пояснения.
        pressedOnOverlay.current = event.target === event.currentTarget && Boolean(layerRef.current?.isTop());
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOnOverlay.current) onClose();
        pressedOnOverlay.current = false;
      }}
    >
      <div
        ref={panelRef}
        className={`${styles.sheet} ${wide ? styles.sheetWide : ''} ui-sheet-up`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={ariaLabel ? undefined : titleId}
        aria-label={ariaLabel}
        tabIndex={-1}
        data-testid={testId}
        onKeyDown={(event) => {
          if (panelRef.current) trapTab(event.nativeEvent, panelRef.current);
        }}
      >
        <div className={styles.sheetHead}>
          <h2 id={titleId} className={styles.sheetTitle}>
            {title}
          </h2>
          <button type="button" className={styles.sheetClose} onClick={onClose}>
            {closeLabel ?? text.close}
          </button>
        </div>
        <div className={styles.sheetBody}>{children}</div>
        {footer ? <div className={styles.sheetFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}
