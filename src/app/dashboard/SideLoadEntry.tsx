'use client';

import type React from 'react';
import { calculateExercisePoints } from '@/lib/exercise-points';
import { formatDuration } from '@/lib/exercise-metrics';
import type { ExerciseDefinition } from '@/lib/exercises';
import { unitsMessages } from '@/i18n/messages/features/units';
import { MAX_WORKOUT_VALUE } from '@/lib/workout-input';
import { useStopwatch } from '@/lib/use-stopwatch';

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

type WeightPickerProps = Pick<Props, 'exercise' | 'locale' | 'tt' | 'loadKg' | 'onLoadKgChange'>;

/** Выбор веса снаряда из пресетов упражнения; для упражнений без снаряда ничего не рисует. */
export function WeightPicker({ exercise, locale, tt, loadKg, onLoadKgChange }: WeightPickerProps) {
  if (!exercise.load) return null;
  const kg = unitsMessages[locale === 'en' ? 'en' : 'ru'].kg;
  return (
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
  );
}

type Stopwatch = ReturnType<typeof useStopwatch>;

/**
 * Ввод подхода на каждую сторону отдельно (руку или ногу), при необходимости — с весом снаряда.
 * У упражнений на время (боковая планка) значение стороны — секунды, у каждой стороны свой
 * секундомер: «Стоп» записывает замер в сторону, запись подхода — по «Добавить».
 */
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
  const kg = unitsMessages[locale === 'en' ? 'en' : 'ru'].kg;
  const total = repsLeft + repsRight;
  const points = calculateExercisePoints(total, exercise.id, loadKg);
  const timed = exercise.unit === 'seconds';
  // Замер принадлежит упражнению и стороне; хранится в localStorage и переживает перезагрузку.
  const leftWatch = useStopwatch(`dashboardSideStopwatch:${exercise.id}:left`);
  const rightWatch = useStopwatch(`dashboardSideStopwatch:${exercise.id}:right`);
  const steps = timed ? [5, 10] : [1, 5];
  const stepLabel = (step: number) => (timed ? `+${step} ${tt('сек')}` : `+${step}`);

  const side = (label: string, value: number, onChange: (next: number) => void, watch: Stopwatch, other: Stopwatch) => {
    const measuring = timed && watch.started;
    return (
      <div style={sideCard}>
        <div style={sideLabel}>{label}</div>
        <input
          inputMode="numeric"
          value={measuring ? formatDuration(watch.elapsedSeconds) : String(value)}
          onChange={(event) => {
            if (!measuring) onChange(parseDigits(event.target.value));
          }}
          onFocus={(event) => event.target.select()}
          readOnly={measuring}
          style={sideInput}
          aria-label={label}
        />
        {measuring ? (
          <button type="button" style={stopButton} onClick={() => onChange(clampReps(watch.finish()))}>
            {tt('Стоп')}
          </button>
        ) : (
          <>
            <div style={sideButtons}>
              {steps.map((step) => (
                <button key={step} type="button" style={sideButton} onClick={() => onChange(clampReps(value + step))}>
                  {stepLabel(step)}
                </button>
              ))}
            </div>
            {timed ? (
              <button
                type="button"
                style={other.started ? { ...startButton, opacity: 0.45, cursor: 'default' } : startButton}
                onClick={watch.start}
                disabled={other.started}
              >
                ▶ {tt('Старт')}
              </button>
            ) : null}
          </>
        )}
      </div>
    );
  };

  return (
    <div style={wrap}>
      <WeightPicker exercise={exercise} locale={locale} tt={tt} loadKg={loadKg} onLoadKgChange={onLoadKgChange} />

      <div style={sidesGrid}>
        {side(tt('Левая'), repsLeft, onRepsLeftChange, leftWatch, rightWatch)}
        {side(tt('Правая'), repsRight, onRepsRightChange, rightWatch, leftWatch)}
      </div>

      <div style={summary}>
        {tt('Итого')}: <b>{total}</b>
        {timed ? <> {tt('сек')}</> : null}
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
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
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

const startButton: React.CSSProperties = {
  ...sideButton,
  fontSize: 18,
  color: '#fff',
  border: 'none',
  background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
};

const stopButton: React.CSSProperties = {
  ...sideButton,
  fontSize: 18,
  color: '#fff',
  border: 'none',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
};

const summary: React.CSSProperties = {
  textAlign: 'center',
  color: '#475569',
  fontSize: 15,
  fontWeight: 700,
};
