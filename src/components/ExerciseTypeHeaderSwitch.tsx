'use client';

import React, { useSyncExternalStore } from 'react';
import { useI18n } from '@/i18n/provider';
import { t } from '@/i18n/translate';
import { getStoredExerciseType, persistExerciseType, subscribeExerciseType, type ExerciseType } from '@/lib/exercise-type-store';

export default function ExerciseTypeHeaderSwitch() {
  const { locale } = useI18n();
  const tt = (input: string) => t(locale, input);
  const exerciseType = useSyncExternalStore<ExerciseType>(subscribeExerciseType, getStoredExerciseType, () => 'pushups');

  const setType = (t: ExerciseType) => {
    persistExerciseType(t);
  };

  const pill = (active: boolean): React.CSSProperties => ({
    padding: '8px 12px',
    borderRadius: 999,
    border: '1px solid #d1d5db',
    background: active ? '#111827' : '#fff',
    color: active ? '#fff' : '#000',
    fontWeight: 800,
    cursor: 'pointer',
    lineHeight: 1,
    whiteSpace: 'nowrap',
  });

  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
      <button type="button" style={pill(exerciseType === 'pushups')} onClick={() => setType('pushups')}>
        {tt('Отжимания')}
      </button>
      <button type="button" style={pill(exerciseType === 'pullups')} onClick={() => setType('pullups')}>
        {tt('Подтягивания')}
      </button>
      <button type="button" style={pill(exerciseType === 'crunches')} onClick={() => setType('crunches')}>
        {tt('Скручивания')}
      </button>
      <button type="button" style={pill(exerciseType === 'squats')} onClick={() => setType('squats')}>
        {tt('Приседания')}
      </button>
      <button type="button" style={pill(exerciseType === 'plank')} onClick={() => setType('plank')}>
        {tt('Планка')}
      </button>
    </div>
  );
}
