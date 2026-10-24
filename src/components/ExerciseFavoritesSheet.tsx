'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { EXERCISE_ORDER, FAVORITE_EXERCISE_LIMIT, exerciseIcon, exerciseLabel, type ExerciseType } from '@/lib/exercises';
import { useFavoriteExercises } from '@/lib/use-favorite-exercises';
import { InfoButton, Sheet } from '@/components/ui';
import styles from './ExerciseFavoritesSheet.module.css';

function fill(template: string, params: Record<string, string | number>) {
  return Object.entries(params).reduce((out, [key, value]) => out.replaceAll(`{${key}}`, String(value)), template);
}

/**
 * Выбор упражнений, закреплённых на экране тренировки («Профиль → Тренировки»). Каждое нажатие
 * сохраняется сразу. Окно на общем `Sheet`: Escape и аппаратная «назад» Android его закрывают.
 */
export default function ExerciseFavoritesSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { messages } = useI18n();
  const copy = messages.favoriteExercises;
  return (
    <Sheet
      open={open}
      onClose={onClose}
      ariaLabel={copy.title}
      title={
        <>
          {copy.title} <InfoButton title={copy.title}>{fill(copy.hint, { limit: FAVORITE_EXERCISE_LIMIT })}</InfoButton>
        </>
      }
      testId="favorites-sheet"
    >
      <FavoritesList />
    </Sheet>
  );
}

function FavoritesList() {
  const { locale, messages } = useI18n();
  const copy = messages.favoriteExercises;
  const { favorites, save } = useFavoriteExercises();
  const [notice, setNotice] = useState<string | null>(null);

  const toggle = async (type: ExerciseType) => {
    const isFavorite = favorites.includes(type);
    if (!isFavorite && favorites.length >= FAVORITE_EXERCISE_LIMIT) {
      setNotice(fill(copy.limitReached, { limit: FAVORITE_EXERCISE_LIMIT }));
      return;
    }
    // Последнее закреплённое не снимаем: пустой список означает «по умолчанию»
    // и вернул бы на главную стандартный набор вместо выбранного.
    if (isFavorite && favorites.length <= 1) return;
    setNotice(null);
    const next = isFavorite ? favorites.filter((item) => item !== type) : [...favorites, type];
    try {
      await save(next);
    } catch {
      setNotice(copy.error);
    }
  };

  return (
    <>
      <p className={styles.counter}>{fill(copy.selected, { count: favorites.length, limit: FAVORITE_EXERCISE_LIMIT })}</p>

      <ul className={styles.list}>
        {EXERCISE_ORDER.map((type) => {
          const checked = favorites.includes(type);
          return (
            <li key={type}>
              <button
                type="button"
                className={`${styles.item} ${checked ? styles.itemChecked : ''}`}
                onClick={() => void toggle(type)}
                aria-pressed={checked}
              >
                <Image src={exerciseIcon(type)} alt="" aria-hidden="true" width={32} height={32} unoptimized />
                <span className={styles.itemLabel}>{exerciseLabel(type, locale)}</span>
                <span className={styles.star} aria-hidden="true">{checked ? '★' : '☆'}</span>
              </button>
            </li>
          );
        })}
      </ul>

      {notice ? <p role="alert" className={styles.notice}>{notice}</p> : null}
    </>
  );
}
