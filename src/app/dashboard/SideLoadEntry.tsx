'use client';

import type React from 'react';
import { calculateExercisePoints } from '@/lib/exercise-points';
import type { ExerciseDefinition } from '@/lib/exercises';
import { MAX_WORKOUT_VALUE } from '@/lib/workout-input';

type Props = {
  exercise: ExerciseDefinition;
  locale: string;
  tt: (input: string) => string;
  loadKg: number | null;
  onLoadKgChange: (next: number) => void;
  repsLeft: number;
  repsRight: number;
  onRepsLeftChange: (next: number) => void;
  onRepsRightChange: (next: number) => void;
};

function clampReps(value: number) {
  return Math.max(0, Math.min(MAX_WORKOUT_VALUE, value));
}

function parseDigits(raw: string) {
  const digits = raw.replace(/[^\d]/g, '');
  return digits === '' ? 0 : clampReps(parseInt(digits, 10));
}

/** Ввод подхода для упражнений со снарядом и/или на каждую руку отдельно. */
export default function SideLoadEntry({
  exercise,
  locale,
  tt,
  loadKg,
  onLoadKgChange,
  repsLeft,
  repsRight,
  onRepsLeftChange,
  onRepsRightChange,
}: Props) {
  const isEnglish = locale === 'en';
  const kg = isEnglish ? 'kg' : 'кг';
  const total = repsLeft + repsRight;
  const points = calculateExercisePoints(total, exercise.id, loadKg);

  const side = (label: string, value: number, onChange: (next: number) => void) => (
    <div style={sideCard}>
      <div style={sideLabel}>{label}</div>
      <input
        inputMode="numeric"
        value={String(value)}
        onChange={(event) => onChange(parseDigits(event.target.value))}
        onFocus={(event) => event.target.select()}
        style={sideInput}
        aria-label={label}
      />
      <div style={sideButtons}>
        <button type="button" style={sideButton} onClick={() => onChange(clampReps(value + 1))}>+1</button>
        <button type="button" style={sideButton} onClick={() => onChange(clampReps(value + 5))}>+5</button>
      </div>
    </div>
  );

  return (
    <div style={wrap}>
      {exercise.load ? (
        <div style={weightRow} role="radiogroup" aria-label={tt('Вес')}>
          {exercise.load.presetsKg.map((preset) => {
            const active = loadKg === preset;
            return (
              <button
                key={preset}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onLoadKgChange(preset)}
                style={weightChip(active)}
              >
                {preset} {kg}
              </button>
            );
          })}
        </div>
      ) : null}

      <div style={sidesGrid}>
        {side(tt('Левая'), repsLeft, onRepsLeftChange)}
        {side(tt('Правая'), repsRight, onRepsRightChange)}
      </div>

      <div style={summary}>
        {tt('Итого')}: <b>{total}</b>
        {loadKg != null ? <> × {loadKg} {kg}</> : null}
        {points > 0 ? <> · ≈ {points.toLocaleString(locale)} {tt('баллов')}</> : null}
      </div>
    </div>
  );
}

const wrap: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
  display: 'grid',
  gap: 12,
};

const weightRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  paddingBottom: 2,
  scrollbarWidth: 'none',
};

function weightChip(active: boolean): React.CSSProperties {
  return {
    flex: '0 0 auto',
    minHeight: 40,
    padding: '0 14px',
    borderRadius: 999,
    border: `1px solid ${active ? 'rgba(249, 115, 22, 0.5)' : 'rgba(148, 163, 184, 0.3)'}`,
    background: active ? 'rgba(255, 237, 213, 0.95)' : '#fff',
    color: '#0f172a',
    fontWeight: 800,
    fontSize: 15,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  };
}

const sidesGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const sideCard: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: 12,
  borderRadius: 24,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.9) 100%)',
  boxShadow: '0 18px 36px rgba(15, 23, 42, 0.06)',
  minWidth: 0,
};

const sideLabel: React.CSSProperties = {
  textAlign: 'center',
  color: '#475569',
  fontSize: 14,
  fontWeight: 800,
};

const sideInput: React.CSSProperties = {
  width: '100%',
  minWidth: 0,
  textAlign: 'center',
  fontWeight: 800,
  fontSize: 'clamp(56px, 14vw, 104px)',
  lineHeight: 1.05,
  padding: '4px 0',
  border: 'none',
  outline: 'none',
  background: 'transparent',
  color: '#0f172a',
};

const sideButtons: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
};

const sideButton: React.CSSProperties = {
  minHeight: 52,
  borderRadius: 16,
  border: '1px solid rgba(255, 255, 255, 0.44)',
  background: 'linear-gradient(135deg, #fde68a 0%, #fbbf24 100%)',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 22,
  cursor: 'pointer',
};

const summary: React.CSSProperties = {
  textAlign: 'center',
  color: '#475569',
  fontSize: 15,
  fontWeight: 700,
};
