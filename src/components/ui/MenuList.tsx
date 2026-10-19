'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import styles from './ui.module.css';

/** Список разделов (профиль, меню): строки на всю ширину, зона нажатия ≥ 56 px. */
export function MenuList({ children, label, className }: { children: ReactNode; label?: string; className?: string }) {
  return (
    <ul className={`${styles.menuList} ${className ?? ''}`} aria-label={label}>
      {children}
    </ul>
  );
}

export type MenuRowProps = {
  label: ReactNode;
  /** Короткая строка под названием (текущее значение раздела, а не пояснение). */
  hint?: ReactNode;
  /** Значение справа (язык, «Включено»). */
  value?: ReactNode;
  icon?: ReactNode;
  /** Внутренняя ссылка; для уровня внутри страницы — `onClick` с `useSubpage().open`. */
  href?: string;
  onClick?: () => void;
  danger?: boolean;
  /** Стрелка «›»: по умолчанию есть у строк, ведущих на уровень/страницу. */
  chevron?: boolean;
  testId?: string;
};

export function MenuRow({ label, hint, value, icon, href, onClick, danger, chevron = true, testId }: MenuRowProps) {
  const className = `${styles.menuRow} ${danger ? styles.menuRowDanger : ''}`;
  const inner = (
    <>
      {icon ? (
        <span className={styles.menuIcon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <span className={styles.menuText}>
        <span className={styles.menuLabel}>{label}</span>
        {hint ? <span className={styles.menuHint}>{hint}</span> : null}
      </span>
      {value ? <span className={styles.menuValue}>{value}</span> : null}
      {chevron ? (
        <span className={styles.menuChevron} aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={className} onClick={onClick} data-testid={testId}>
          {inner}
        </Link>
      ) : (
        <button type="button" className={className} onClick={onClick} data-testid={testId}>
          {inner}
        </button>
      )}
    </li>
  );
}
