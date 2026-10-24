'use client';

import Image from 'next/image';
import { useMemo, type CSSProperties } from 'react';
import { computePeriodStatsTable, streakFreezeMessages, type DayStatsWorkout, type PeriodStats } from '@/lib/day-stats';
import type { DayKey } from '@/lib/calendar-day';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import { EXERCISE_ORDER, createByExercise, exerciseIcon, type ExerciseType } from '@/lib/exercises';
import { dashboardLiteMessages } from '@/i18n/messages/features/dashboard-lite';
import type { Locale } from '@/i18n/locale';

type Breakdown = Record<ExerciseType, number | string>;

// Пустые значения в статистике: ноль и прочерки средних без данных.
function hasBreakdownValue(value: number | string | undefined) {
  if (value == null) return false;
  if (typeof value === 'number') return value !== 0;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== '-' && trimmed !== '—' && Number(trimmed) !== 0;
}

/** Плитка периода: разбивка по упражнениям, по которым за период есть записи. */
function Stat({ label, breakdown, locale, metric = true }: { label: string; breakdown: Breakdown; locale: Locale; metric?: boolean }) {
  const types = EXERCISE_ORDER.filter((type) => hasBreakdownValue(breakdown[type]));
  return (
    <div className="app-tile app-tile--breakdown">
      <div className="app-tile__title">{label}</div>
      <div style={breakdownWrap}>
        {types.length ? types.map((type) => (
          <span key={`${label}-${type}`} style={breakdownItem}>
            <Image src={exerciseIcon(type)} alt="" aria-hidden="true" width={20} height={20} style={breakdownIcon} unoptimized />
            <span style={breakdownValue}>
              {metric ? formatExerciseValue(breakdown[type], type, true, locale).replace(/ (сек|sec)$/, '') : breakdown[type]}
            </span>
          </span>
        )) : (
          <span style={breakdownValue}>—</span>
        )}
      </div>
    </div>
  );
}

/**
 * «Статистика по периодам» (R10.3): бывшая таблица «Всего» с дашборда — сегодня, всего, год,
 * месяц, неделя, среднее в день и серия, с разбивкой по упражнениям. Цифры — `computePeriodStats`
 * по каждому упражнению, как раньше на дашборде; фильтры «Аналитики» на блок не влияют.
 */
export default function PeriodStatsPanel({ workouts, today, locale }: { workouts: DayStatsWorkout[]; today: DayKey; locale: Locale }) {
  const text = dashboardLiteMessages[locale].periods;
  const freeze = streakFreezeMessages[locale];
  const table = useMemo(() => computePeriodStatsTable(workouts, today), [workouts, today]);
  const pick = (value: (s: PeriodStats) => number): Breakdown => createByExercise((type) => value(table.byExercise[type]));
  const streak: Breakdown = createByExercise((type) => {
    const s = table.byExercise[type];
    return s.streakFreezeUsed ? `${s.streak} ${freeze.badge}` : s.streak;
  });

  return (
    <section className="app-tiles" data-testid="period-stats">
      <Stat label={text.today} breakdown={pick((s) => s.totalToday)} locale={locale} />
      <Stat label={text.all} breakdown={pick((s) => s.totalAll)} locale={locale} />
      <Stat label={text.year} breakdown={pick((s) => s.totalYear)} locale={locale} />
      <Stat label={text.month} breakdown={pick((s) => s.totalMonth)} locale={locale} />
      <Stat label={text.week} breakdown={pick((s) => s.totalWeek)} locale={locale} />
      <Stat label={text.avgMonth} breakdown={pick((s) => s.avgPerDayMonth)} locale={locale} />
      <Stat label={text.avgYear} breakdown={pick((s) => s.avgPerDayYear)} locale={locale} />
      <Stat label={text.avgAll} breakdown={pick((s) => s.avgPerDayAll)} locale={locale} />
      <Stat label={text.streak} breakdown={streak} locale={locale} metric={false} />
    </section>
  );
}

const breakdownWrap: CSSProperties = {
  marginTop: 2,
  width: '100%',
  display: 'grid',
  gap: 2,
  alignContent: 'start',
  justifyItems: 'start',
};

const breakdownItem: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'clamp(16px, 1.2vw, 20px) auto',
  alignItems: 'center',
  justifyContent: 'start',
  justifyItems: 'start',
  gap: 'clamp(3px, 0.3vw, 6px)',
  minWidth: 0,
  lineHeight: 1,
  width: '100%',
};

const breakdownIcon: CSSProperties = {
  width: 'clamp(16px, 1.2vw, 20px)',
  height: 'clamp(16px, 1.2vw, 20px)',
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
  justifySelf: 'center',
};

const breakdownValue: CSSProperties = {
  fontSize: 'clamp(11px, 0.9vw, 15px)',
  fontWeight: 900,
  color: '#0f172a',
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'left',
};
