'use client';

import React, { useSyncExternalStore } from 'react';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';
import { getStoredExerciseType, persistExerciseType, subscribeExerciseType, type ExerciseType } from '@/lib/exercise-type-store';

const OPTIONS: { value: ExerciseType; label: string }[] = [
  { value: 'pushups', label: 'Отжимания' },
  { value: 'pullups', label: 'Подтягивания' },
  { value: 'crunches', label: 'Скручивания' },
  { value: 'squats', label: 'Приседания' },
  { value: 'plank', label: 'Планка' },
];

export default function ExerciseTypeDropdown() {
  const { locale } = useI18n();
  const tt = (input: string) => t(locale, input);
  const value = useSyncExternalStore<ExerciseType>(subscribeExerciseType, getStoredExerciseType, () => 'pushups');

  const onChange = (v: ExerciseType) => {
    persistExerciseType(v);
  };

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ExerciseType)}
      style={{
        height: 34,
        padding: '0 10px',
        borderRadius: 10,
        border: '1px solid #d1d5db',
        background: '#fff',
        color: '#000',
        fontWeight: 700,
        outline: 'none',
        maxWidth: 'min(60vw, 240px)',
      }}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>{tt(o.label)}</option>
      ))}
    </select>
  );
}
