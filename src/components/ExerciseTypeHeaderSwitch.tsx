'use client';

import React, { useEffect, useState } from 'react';

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats';
const KEY = 'exerciseType';

function isValid(v: any): v is ExerciseType {
  return v === 'pushups' || v === 'pullups' || v === 'crunches' || v === 'squats';
}

export default function ExerciseTypeHeaderSwitch() {
  const [exerciseType, setExerciseType] = useState<ExerciseType>('pushups');

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? window.localStorage.getItem(KEY) : null;
    if (isValid(saved)) setExerciseType(saved);
  }, []);

  const setType = (t: ExerciseType) => {
    setExerciseType(t);
    try { window.localStorage.setItem(KEY, t); } catch {}
    window.dispatchEvent(new CustomEvent('exerciseTypeChanged', { detail: t }));
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
        Отжимания
      </button>
      <button type="button" style={pill(exerciseType === 'pullups')} onClick={() => setType('pullups')}>
        Подтягивания
      </button>
      <button type="button" style={pill(exerciseType === 'crunches')} onClick={() => setType('crunches')}>
        Скручивания
      </button>
      <button type="button" style={pill(exerciseType === 'squats')} onClick={() => setType('squats')}>
        Приседания
      </button>
    </div>
  );
}
