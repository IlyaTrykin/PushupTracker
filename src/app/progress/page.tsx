'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats';
type ExerciseFilter = ExerciseType | 'all';

type Workout = {
  id: string;
  reps: number;
  date: string;
  time?: string | null;
  exerciseType?: string;
};

type DayPoint = {
  key: string;
  date: Date;
  total: number;
  byExercise: Record<ExerciseType, number>;
};

type WeekPoint = {
  key: string;
  start: Date;
  total: number;
  byExercise: Record<ExerciseType, number>;
};

const EXERCISE_ORDER: ExerciseType[] = ['pushups', 'pullups', 'crunches', 'squats'];
const PERIOD_OPTIONS = [
  { days: 7, label: '7д' },
  { days: 30, label: '30д' },
  { days: 90, label: '90д' },
  { days: 365, label: 'Год' },
] as const;

function emptyByExercise(): Record<ExerciseType, number> {
  return { pushups: 0, pullups: 0, crunches: 0, squats: 0 };
}

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function toExerciseType(v?: string | null): ExerciseType {
  if (v === 'pullups' || v === 'crunches' || v === 'squats') return v;
  return 'pushups';
}

function exerciseLabel(type: ExerciseType): string {
  if (type === 'pushups') return 'Отжимания';
  if (type === 'pullups') return 'Подтягивания';
  if (type === 'crunches') return 'Скручивания';
  return 'Приседания';
}

function exerciseColor(type: ExerciseType): string {
  if (type === 'pushups') return '#38bdf8';
  if (type === 'pullups') return '#ef4444';
  if (type === 'crunches') return '#22c55e';
  return '#b8860b';
}

function normalizeDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay(); // 0 sunday
  const shift = (day + 6) % 7;
  return addDays(startOfDay(d), -shift);
}

function getWorkoutDate(w: Workout): Date {
  return new Date(w.time || w.date);
}

function sumReps(items: Workout[]): number {
  return items.reduce((acc, w) => acc + (w.reps || 0), 0);
}

function calcStreak(items: Workout[]): number {
  if (!items.length) return 0;
  const byDay = new Set<string>();
  for (const w of items) byDay.add(normalizeDate(startOfDay(getWorkoutDate(w))));

  const sortedDesc = Array.from(byDay).sort().reverse();
  if (!sortedDesc.length) return 0;

  let streak = 0;
  let cursor = new Date(`${sortedDesc[0]}T00:00:00`);
  while (true) {
    const key = normalizeDate(cursor);
    if (!byDay.has(key)) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }

  return streak;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const normalized = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function StatCard({
  label,
  value,
  hint,
  accentColor = '#0ea5e9',
}: {
  label: string;
  value: string | number;
  hint?: string;
  accentColor?: string;
}) {
  return (
    <div
      style={{
        border: `1px solid ${hexToRgba(accentColor, 0.26)}`,
        borderRadius: 16,
        background: `linear-gradient(180deg, ${hexToRgba(accentColor, 0.13)} 0%, #ffffff 68%)`,
        padding: '14px 14px 13px',
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 900, color: '#334155', letterSpacing: 0.2 }}>{label}</div>
      <div style={{ fontSize: 30, lineHeight: 1.1, fontWeight: 900, color: '#0b1324', marginTop: 7 }}>{value}</div>
      {hint ? <div style={{ fontSize: 12, color: '#475569', marginTop: 7 }}>{hint}</div> : null}
    </div>
  );
}

function formatSigned(value: number): string {
  if (value > 0) return `+${value}`;
  return String(value);
}

function formatDeltaPercent(current: number, previous: number): string {
  if (previous === 0) return current === 0 ? '0%' : 'новый рост';
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? '+' : ''}${pct}%`;
}

function HeroOverview({
  currentTotal,
  previousTotal,
  delta,
  deltaPercent,
  streak,
  trainingDays,
  periodDays,
  color,
  tt,
}: {
  currentTotal: number;
  previousTotal: number;
  delta: number;
  deltaPercent: string;
  streak: number;
  trainingDays: number;
  periodDays: number;
  color: string;
  tt: (input: string) => string;
}) {
  const isPositive = delta >= 0;
  const deltaColor = isPositive ? '#16a34a' : '#dc2626';

  return (
    <section
      style={{
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 20,
        border: `1px solid ${hexToRgba(color, 0.32)}`,
        background: `linear-gradient(130deg, ${hexToRgba(color, 0.26)} 0%, #f8fbff 52%, #ffffff 100%)`,
        padding: 18,
        display: 'grid',
        gap: 14,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: -70,
          right: -60,
          width: 180,
          height: 180,
          borderRadius: 999,
          background: hexToRgba(color, 0.16),
          filter: 'blur(6px)',
        }}
      />
      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          bottom: -48,
          left: -22,
          width: 150,
          height: 150,
          borderRadius: 999,
          background: 'rgba(14, 165, 233, 0.12)',
          filter: 'blur(6px)',
        }}
      />

      <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>{tt('Объём за период')}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
          <div style={{ fontSize: 52, lineHeight: 0.9, fontWeight: 900, color: '#0b1324' }}>{currentTotal}</div>
          <div style={{ fontSize: 13, color: '#475569', marginBottom: 6 }}>{tt('повторений')}</div>
        </div>
      </div>

      <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            padding: '6px 10px',
            fontWeight: 800,
            fontSize: 12,
            color: '#fff',
            background: deltaColor,
          }}
        >
          {isPositive ? tt('Рост') : tt('Спад')} {formatSigned(delta)} ({deltaPercent})
        </span>
        <span style={{ fontSize: 12, fontWeight: 800, color: '#334155', background: '#fff', border: '1px solid #dbe4f0', borderRadius: 999, padding: '6px 10px' }}>
          {tt('Было')}: {previousTotal}
        </span>
      </div>

      <div
        style={{
          position: 'relative',
          zIndex: 1,
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        }}
      >
        <div style={{ borderRadius: 12, border: '1px solid #dbe4f0', background: '#ffffffd6', padding: '10px 11px' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800 }}>{tt('Активность')}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0b1324', marginTop: 4 }}>{trainingDays}/{periodDays}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{tt('дней с тренировками')}</div>
        </div>
        <div style={{ borderRadius: 12, border: '1px solid #dbe4f0', background: '#ffffffd6', padding: '10px 11px' }}>
          <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800 }}>{tt('Серия')}</div>
          <div style={{ fontSize: 22, fontWeight: 900, color: '#0b1324', marginTop: 4 }}>{streak}</div>
          <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>{tt('дней подряд')}</div>
        </div>
      </div>
    </section>
  );
}

function ExerciseShareDonut({
  totals,
  periodTotal,
  tt,
}: {
  totals: Record<ExerciseType, number>;
  periodTotal: number;
  tt: (input: string) => string;
}) {
  const size = 190;
  const center = size / 2;
  const radius = 64;
  const stroke = 18;
  const circumference = 2 * Math.PI * radius;

  const segments: Array<{ type: ExerciseType; value: number; ratio: number; length: number; offset: number }> = [];
  let offset = 0;
  for (const type of EXERCISE_ORDER) {
    const value = totals[type];
    if (periodTotal <= 0 || value <= 0) continue;
    const ratio = value / periodTotal;
    const length = ratio * circumference;
    segments.push({ type, value, ratio, length, offset });
    offset += length;
  }

  return (
    <section
      style={{
        border: '1px solid #dbe4ff',
        borderRadius: 18,
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
        padding: 14,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ fontWeight: 900, color: '#0f172a' }}>{tt('Структура объёма')}</div>

      <div style={{ display: 'grid', justifyItems: 'center', gap: 10 }}>
        <svg width={size} height={size} role="img" aria-label={tt('Круговая диаграмма структуры упражнений')}>
          <g transform={`rotate(-90 ${center} ${center})`}>
            <circle cx={center} cy={center} r={radius} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
            {segments.map((s) => (
              <circle
                key={s.type}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={exerciseColor(s.type)}
                strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={`${s.length} ${Math.max(circumference - s.length, 0)}`}
                strokeDashoffset={-s.offset}
              />
            ))}
          </g>

          <text x={center} y={center - 6} textAnchor="middle" fontSize={12} fill="#64748b" fontWeight={800}>{tt('За период')}</text>
          <text x={center} y={center + 24} textAnchor="middle" fontSize={30} fill="#0b1324" fontWeight={900}>{periodTotal}</text>
        </svg>
      </div>

      <div style={{ display: 'grid', gap: 7 }}>
        {EXERCISE_ORDER.map((type) => {
          const value = totals[type];
          const ratio = periodTotal > 0 ? Math.round((value / periodTotal) * 100) : 0;
          return (
            <div key={type} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#0f172a', fontWeight: 800 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: exerciseColor(type) }} />
                {tt(exerciseLabel(type))}
              </div>
              <div style={{ fontSize: 12, color: '#334155', fontWeight: 800 }}>{value} ({ratio}%)</div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ActivityRhythm({ data, color, tt, localeTag }: { data: DayPoint[]; color: string; tt: (input: string) => string; localeTag: string }) {
  if (!data.length) return null;

  const max = Math.max(1, ...data.map((d) => d.total));
  const active = data.filter((d) => d.total > 0).length;

  return (
    <section
      style={{
        border: '1px solid #dbe4ff',
        borderRadius: 18,
        background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
        padding: 14,
        display: 'grid',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, color: '#0f172a' }}>{tt('Ритм активности')}</div>
        <div style={{ fontSize: 12, color: '#334155', fontWeight: 800 }}>{tt('Активных дней')}: {active}/{data.length}</div>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <div style={{ minWidth: Math.max(350, data.length * 16), display: 'flex', gap: 5, alignItems: 'flex-end' }}>
          {data.map((d, idx) => {
            const ratio = d.total / max;
            const h = d.total > 0 ? 10 + Math.round(ratio * 78) : 6;
            const showLabel = idx === 0 || idx === data.length - 1 || idx % 5 === 0;
            return (
              <div key={d.key} style={{ width: 12, display: 'grid', gap: 5, justifyItems: 'center' }}>
                <div style={{ height: 92, display: 'flex', alignItems: 'flex-end' }}>
                  <div
                    title={`${d.date.toLocaleDateString(localeTag)}: ${d.total}`}
                    style={{
                      width: 10,
                      height: h,
                      borderRadius: 999,
                      background: d.total > 0 ? `linear-gradient(180deg, ${hexToRgba(color, 0.34)} 0%, ${color} 100%)` : '#dbeafe',
                      boxShadow: d.total > 0 ? `0 3px 8px ${hexToRgba(color, 0.25)}` : 'none',
                    }}
                  />
                </div>
                <div style={{ fontSize: 9, color: '#64748b', minHeight: 10 }}>{showLabel ? String(d.date.getDate()).padStart(2, '0') : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function TrendChart({ data, color, tt }: { data: DayPoint[]; color: string; tt: (input: string) => string }) {
  if (!data.length) return null;

  const width = Math.max(390, data.length * 24);
  const height = 220;
  const padX = 18;
  const padTop = 16;
  const padBottom = 40;
  const chartHeight = height - padTop - padBottom;
  const maxValue = Math.max(1, ...data.map((d) => d.total));
  const avgValue = Math.round(data.reduce((acc, d) => acc + d.total, 0) / data.length);

  const xFor = (i: number) => (data.length === 1 ? width / 2 : padX + (i * (width - padX * 2)) / (data.length - 1));
  const yFor = (v: number) => padTop + chartHeight - (v / maxValue) * chartHeight;

  const points = data.map((d, i) => `${xFor(i)},${yFor(d.total)}`).join(' ');
  const area = `${xFor(0)},${height - padBottom} ${points} ${xFor(data.length - 1)},${height - padBottom}`;
  const avgY = yFor(avgValue);

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(maxValue * k)).filter((v, i, arr) => arr.indexOf(v) === i);
  let peakIndex = 0;
  for (let i = 1; i < data.length; i += 1) {
    if (data[i].total > data[peakIndex].total) peakIndex = i;
  }
  const labelStep = Math.max(1, Math.ceil(data.length / 7));

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #dbe4ff', borderRadius: 14, background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)' }}>
      <svg width={width} height={height} role="img" aria-label={tt('График повторений по дням')}>
        <defs>
          <linearGradient id="dayAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hexToRgba(color, 0.34)} />
            <stop offset="100%" stopColor={hexToRgba(color, 0.03)} />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={width} height={height} fill="transparent" rx={12} />

        {ticks.map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />
              <text x={4} y={y + 4} fontSize={10} fill="#64748b">{t}</text>
            </g>
          );
        })}

        <line x1={padX} x2={width - padX} y1={avgY} y2={avgY} stroke="#94a3b8" strokeDasharray="4 4" strokeWidth={1} />
        <text x={width - padX - 2} y={avgY - 4} textAnchor="end" fontSize={10} fill="#64748b">{tt(`ср. ${avgValue}`)}</text>

        <polygon points={area} fill="url(#dayAreaFill)" />
        <polyline points={points} fill="none" stroke={color} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" />

        {data.map((d, i) => (
          <circle key={d.key} cx={xFor(i)} cy={yFor(d.total)} r={i === peakIndex ? 4 : 2.6} fill={color} />
        ))}

        <text x={xFor(peakIndex)} y={Math.max(14, yFor(data[peakIndex].total) - 8)} textAnchor="middle" fontSize={10} fill="#0f172a" fontWeight={800}>
          {tt(`пик ${data[peakIndex].total}`)}
        </text>

        {data.map((d, i) => {
          if (i !== 0 && i !== data.length - 1 && i % labelStep !== 0) return null;
          return (
            <text key={`lab-${d.key}`} x={xFor(i)} y={height - 12} textAnchor="middle" fontSize={9} fill="#64748b">
              {String(d.date.getDate()).padStart(2, '0')}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

function WeeklyTrendChart({
  weeks,
  currentTotals,
  previousTotals,
  color,
  tt,
}: {
  weeks: WeekPoint[];
  currentTotals: number[];
  previousTotals: number[];
  color: string;
  tt: (input: string) => string;
}) {
  if (!weeks.length) return null;

  const width = Math.max(380, weeks.length * 72);
  const height = 230;
  const padLeft = 38;
  const padRight = 14;
  const padTop = 14;
  const padBottom = 42;
  const chartWidth = width - padLeft - padRight;
  const chartHeight = height - padTop - padBottom;

  const maxValue = Math.max(1, ...currentTotals, ...previousTotals);
  const xFor = (i: number) => (weeks.length <= 1 ? padLeft + chartWidth / 2 : padLeft + (i * chartWidth) / (weeks.length - 1));
  const yFor = (v: number) => padTop + chartHeight - (v / maxValue) * chartHeight;

  const currentPoints = weeks.map((_, i) => `${xFor(i)},${yFor(currentTotals[i] || 0)}`).join(' ');
  const previousPoints = weeks.map((_, i) => `${xFor(i)},${yFor(previousTotals[i] || 0)}`).join(' ');
  const currentArea = `${xFor(0)},${height - padBottom} ${currentPoints} ${xFor(weeks.length - 1)},${height - padBottom}`;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((k) => Math.round(maxValue * k)).filter((v, i, arr) => arr.indexOf(v) === i);

  const labelStep = Math.max(1, Math.ceil(weeks.length / 6));
  const labelIndexes: number[] = [];
  for (let i = 0; i < weeks.length; i += labelStep) labelIndexes.push(i);
  if (!labelIndexes.includes(weeks.length - 1)) labelIndexes.push(weeks.length - 1);

  return (
    <div style={{ overflowX: 'auto', border: '1px solid #dbe4ff', borderRadius: 14, background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)' }}>
      <svg width={width} height={height} role="img" aria-label={tt('Недельный график: текущий и прошлый период')}>
        <defs>
          <linearGradient id="weeklyAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={hexToRgba(color, 0.36)} />
            <stop offset="100%" stopColor={hexToRgba(color, 0.03)} />
          </linearGradient>
        </defs>

        <rect x={0} y={0} width={width} height={height} fill="transparent" rx={14} />

        {yTicks.map((t) => {
          const y = yFor(t);
          return (
            <g key={t}>
              <line x1={padLeft} x2={width - padRight} y1={y} y2={y} stroke="#e6ecff" strokeWidth={1} />
              <text x={4} y={y + 4} fontSize={10} fill="#6b7280">{t}</text>
            </g>
          );
        })}

        <polyline points={previousPoints} fill="none" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" strokeLinecap="round" />
        <polygon points={currentArea} fill="url(#weeklyAreaFill)" />
        <polyline points={currentPoints} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />

        {weeks.map((w, i) => (
          <g key={w.key}>
            <circle cx={xFor(i)} cy={yFor(currentTotals[i] || 0)} r={3} fill={color} />
            <title>{`${formatWeekRange(w.start)}: ${currentTotals[i] || 0}`}</title>
          </g>
        ))}

        {labelIndexes.map((i) => (
          <text key={`x-${weeks[i].key}`} x={xFor(i)} y={height - 12} fontSize={10} fill="#4b5563" textAnchor="middle">
            {formatWeekRange(weeks[i].start)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function formatWeekRange(weekStart: Date): string {
  const end = addDays(weekStart, 6);
  const a = `${String(weekStart.getDate()).padStart(2, '0')}.${String(weekStart.getMonth() + 1).padStart(2, '0')}`;
  const b = `${String(end.getDate()).padStart(2, '0')}.${String(end.getMonth() + 1).padStart(2, '0')}`;
  return `${a}-${b}`;
}

export default function ProgressPage() {
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = (input: string) => t(locale, input);
  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [exercise, setExercise] = useState<ExerciseFilter>('all');

  const today = useMemo(() => startOfDay(new Date()), []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setError(null);
      try {
        const data = await fetchJsonSafe('/api/workouts');
        const items = Array.isArray(data) ? data : (data?.items ?? []);
        if (!cancelled) setWorkouts(items);
      } catch (e: any) {
        if (!cancelled) setError(tt(e?.message || 'Ошибка загрузки'));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const rangeStart = useMemo(() => addDays(today, -(periodDays - 1)), [today, periodDays]);
  const rangeEnd = today;

  const scopedByExercise = useMemo(() => {
    if (exercise === 'all') return workouts;
    return workouts.filter((w) => toExerciseType(w.exerciseType) === exercise);
  }, [workouts, exercise]);

  const inRange = useMemo(() => {
    const startMs = rangeStart.getTime();
    const endMs = rangeEnd.getTime();

    return scopedByExercise.filter((w) => {
      const d = startOfDay(getWorkoutDate(w)).getTime();
      return d >= startMs && d <= endMs;
    });
  }, [scopedByExercise, rangeStart, rangeEnd]);

  const daySeries = useMemo<DayPoint[]>(() => {
    const list: DayPoint[] = [];
    const index = new Map<string, DayPoint>();

    for (let i = 0; i < periodDays; i += 1) {
      const d = addDays(rangeStart, i);
      const key = normalizeDate(d);
      const point: DayPoint = { key, date: d, total: 0, byExercise: emptyByExercise() };
      list.push(point);
      index.set(key, point);
    }

    for (const w of inRange) {
      const d = startOfDay(getWorkoutDate(w));
      const key = normalizeDate(d);
      const row = index.get(key);
      if (!row) continue;
      const t = toExerciseType(w.exerciseType);
      row.byExercise[t] += w.reps || 0;
      row.total += w.reps || 0;
    }

    return list;
  }, [inRange, rangeStart, periodDays]);

  const totals = useMemo(() => {
    const total = daySeries.reduce((acc, d) => acc + d.total, 0);
    const trainingDays = daySeries.filter((d) => d.total > 0).length;
    const avgPerTraining = trainingDays ? Math.round(total / trainingDays) : 0;
    return { total, trainingDays, avgPerTraining };
  }, [daySeries]);

  const previousRangeStart = useMemo(() => addDays(rangeStart, -periodDays), [rangeStart, periodDays]);
  const previousRangeEnd = useMemo(() => addDays(rangeStart, -1), [rangeStart]);

  const previousPeriodStats = useMemo(() => {
    const startMs = previousRangeStart.getTime();
    const endMs = previousRangeEnd.getTime();

    const prev = scopedByExercise.filter((w) => {
      const d = startOfDay(getWorkoutDate(w)).getTime();
      return d >= startMs && d <= endMs;
    });

    const total = sumReps(prev);
    const trainingDays = new Set(prev.map((w) => normalizeDate(startOfDay(getWorkoutDate(w))))).size;
    const avgPerTraining = trainingDays ? Math.round(total / trainingDays) : 0;
    return { total, trainingDays, avgPerTraining };
  }, [scopedByExercise, previousRangeStart, previousRangeEnd]);

  const comparisonStats = useMemo(() => {
    const deltaTotal = totals.total - previousPeriodStats.total;
    const deltaTrainingDays = totals.trainingDays - previousPeriodStats.trainingDays;
    const dailyCurrent = Math.round(totals.total / periodDays);
    const dailyPrevious = Math.round(previousPeriodStats.total / periodDays);
    return {
      deltaTotal,
      deltaTrainingDays,
      dailyCurrent,
      dailyPrevious,
      deltaDaily: dailyCurrent - dailyPrevious,
    };
  }, [totals, previousPeriodStats, periodDays]);
  const deltaPercentLabel = useMemo(
    () => tt(formatDeltaPercent(totals.total, previousPeriodStats.total)),
    [previousPeriodStats.total, totals.total, tt],
  );

  const streak = useMemo(() => calcStreak(scopedByExercise), [scopedByExercise]);

  const weekSeries = useMemo<WeekPoint[]>(() => {
    const firstWeek = startOfWeekMonday(rangeStart);
    const lastWeek = startOfWeekMonday(rangeEnd);

    const list: WeekPoint[] = [];
    const index = new Map<string, WeekPoint>();

    for (let cur = new Date(firstWeek); cur <= lastWeek; cur = addDays(cur, 7)) {
      const key = normalizeDate(cur);
      const row: WeekPoint = { key, start: new Date(cur), total: 0, byExercise: emptyByExercise() };
      list.push(row);
      index.set(key, row);
    }

    for (const w of inRange) {
      const d = startOfDay(getWorkoutDate(w));
      const wk = startOfWeekMonday(d);
      const row = index.get(normalizeDate(wk));
      if (!row) continue;
      const t = toExerciseType(w.exerciseType);
      row.byExercise[t] += w.reps || 0;
      row.total += w.reps || 0;
    }

    return list;
  }, [inRange, rangeStart, rangeEnd]);

  const weeklyTotals = useMemo(() => weekSeries.map((w) => w.total), [weekSeries]);

  const previousWeeklyTotals = useMemo(() => {
    const firstWeek = startOfWeekMonday(previousRangeStart);
    const lastWeek = startOfWeekMonday(previousRangeEnd);
    const weeks: Array<{ key: string; total: number }> = [];
    const index = new Map<string, number>();

    for (let cur = new Date(firstWeek); cur <= lastWeek; cur = addDays(cur, 7)) {
      const key = normalizeDate(cur);
      index.set(key, weeks.length);
      weeks.push({ key, total: 0 });
    }

    for (const w of scopedByExercise) {
      const d = startOfDay(getWorkoutDate(w));
      if (d < previousRangeStart || d > previousRangeEnd) continue;
      const wk = normalizeDate(startOfWeekMonday(d));
      const rowIndex = index.get(wk);
      if (rowIndex === undefined) continue;
      weeks[rowIndex].total += w.reps || 0;
    }

    const raw = weeks.map((w) => w.total);
    if (raw.length === weekSeries.length) return raw;
    if (raw.length > weekSeries.length) return raw.slice(raw.length - weekSeries.length);
    return [...new Array(weekSeries.length - raw.length).fill(0), ...raw];
  }, [scopedByExercise, previousRangeStart, previousRangeEnd, weekSeries.length]);

  const records = useMemo(() => {
    const all = scopedByExercise;
    if (!all.length) {
      return {
        bestDay: null as null | { key: string; total: number },
        bestWeek: null as null | { key: string; total: number },
        bestSet: null as null | Workout,
        lastWorkout: null as null | Workout,
      };
    }

    const byDay = new Map<string, number>();
    const byWeek = new Map<string, number>();

    for (const w of all) {
      const d = startOfDay(getWorkoutDate(w));
      const dayKey = normalizeDate(d);
      byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + (w.reps || 0));

      const weekKey = normalizeDate(startOfWeekMonday(d));
      byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + (w.reps || 0));
    }

    let bestDay: { key: string; total: number } | null = null;
    for (const [key, total] of byDay.entries()) {
      if (!bestDay || total > bestDay.total || (total === bestDay.total && key > bestDay.key)) {
        bestDay = { key, total };
      }
    }

    let bestWeek: { key: string; total: number } | null = null;
    for (const [key, total] of byWeek.entries()) {
      if (!bestWeek || total > bestWeek.total || (total === bestWeek.total && key > bestWeek.key)) {
        bestWeek = { key, total };
      }
    }

    const bestSet = [...all].sort((a, b) => {
      if ((b.reps || 0) !== (a.reps || 0)) return (b.reps || 0) - (a.reps || 0);
      return getWorkoutDate(b).getTime() - getWorkoutDate(a).getTime();
    })[0];

    const lastWorkout = [...all].sort((a, b) => getWorkoutDate(b).getTime() - getWorkoutDate(a).getTime())[0];

    return { bestDay, bestWeek, bestSet, lastWorkout };
  }, [scopedByExercise]);

  const mainColor = exercise === 'all' ? '#0ea5e9' : exerciseColor(exercise);
  const rangeByExerciseTotals = useMemo(() => {
    const out = emptyByExercise();
    for (const row of daySeries) {
      for (const type of EXERCISE_ORDER) out[type] += row.byExercise[type];
    }
    return out;
  }, [daySeries]);
  const rhythmData = useMemo(() => daySeries.slice(-Math.min(30, daySeries.length)), [daySeries]);

  return (
    <div className="app-page" style={{ maxWidth: 980, display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link href="/dashboard" style={{ textDecoration: 'none' }}>← {tt('На тренировку')}</Link>
      </div>

      {error ? <p style={{ color: 'red', margin: 0 }}>{error}</p> : null}

      <section style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#f9fafb', padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 900, color: '#111827' }}>{tt('Фильтры')}</div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PERIOD_OPTIONS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => setPeriodDays(p.days)}
              style={{
                padding: '8px 11px',
                borderRadius: 10,
                border: `1px solid ${periodDays === p.days ? '#2563eb' : '#d1d5db'}`,
                background: periodDays === p.days ? '#eff6ff' : '#fff',
                color: '#111827',
                cursor: 'pointer',
                fontWeight: 800,
              }}
            >
              {tt(p.label)}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: '#374151' }}>{tt('Упражнение:')}</div>
          <select
            value={exercise}
            onChange={(e) => setExercise(e.target.value as ExerciseFilter)}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              background: '#fff',
              color: '#111827',
              fontWeight: 800,
              minWidth: 210,
            }}
          >
            <option value="all">{tt('Все упражнения')}</option>
            {EXERCISE_ORDER.map((t) => (
              <option key={t} value={t}>{tt(exerciseLabel(t))}</option>
            ))}
          </select>
        </div>
      </section>

      <HeroOverview
        currentTotal={totals.total}
        previousTotal={previousPeriodStats.total}
        delta={comparisonStats.deltaTotal}
        deltaPercent={deltaPercentLabel}
        streak={streak}
        trainingDays={totals.trainingDays}
        periodDays={periodDays}
        color={mainColor}
        tt={tt}
      />

      <section style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <StatCard
          label={tt('Текущий период')}
          value={totals.total}
          hint={`${rangeStart.toLocaleDateString(localeTag)} - ${rangeEnd.toLocaleDateString(localeTag)}`}
          accentColor={mainColor}
        />
        <StatCard
          label={tt('Прошлый период')}
          value={previousPeriodStats.total}
          hint={`${previousRangeStart.toLocaleDateString(localeTag)} - ${previousRangeEnd.toLocaleDateString(localeTag)}`}
          accentColor="#64748b"
        />
        <StatCard
          label={tt('Разница')}
          value={formatSigned(comparisonStats.deltaTotal)}
          hint={`${deltaPercentLabel} ${tt('к прошлому периоду')}`}
          accentColor={comparisonStats.deltaTotal >= 0 ? '#16a34a' : '#dc2626'}
        />
        <StatCard
          label={tt('Активные дни')}
          value={`${totals.trainingDays}/${periodDays}`}
          hint={tt(`было ${previousPeriodStats.trainingDays}/${periodDays} (${formatSigned(comparisonStats.deltaTrainingDays)})`)}
          accentColor="#2563eb"
        />
        <StatCard
          label={tt('Среднее в день')}
          value={comparisonStats.dailyCurrent}
          hint={tt(`было ${comparisonStats.dailyPrevious} (${formatSigned(comparisonStats.deltaDaily)})`)}
          accentColor="#0891b2"
        />
        <StatCard
          label={tt('Среднее за тренировку')}
          value={totals.avgPerTraining}
          hint={tt(`было ${previousPeriodStats.avgPerTraining}`)}
          accentColor="#9333ea"
        />
      </section>

      <section style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <div style={{ border: '1px solid #dbe4ff', borderRadius: 16, background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', padding: 12, display: 'grid', gap: 10 }}>
          <div style={{ fontWeight: 900, color: '#111827' }}>{tt('Динамика по дням')}</div>
          <TrendChart data={daySeries} color={mainColor} tt={tt} />
          <div style={{ fontSize: 12, color: '#64748b' }}>
            {tt(`Период: ${rangeStart.toLocaleDateString(localeTag)} - ${rangeEnd.toLocaleDateString(localeTag)}`)}
          </div>
        </div>
        <ExerciseShareDonut totals={rangeByExerciseTotals} periodTotal={totals.total} tt={tt} />
      </section>

      <section style={{ border: '1px solid #dbe4ff', borderRadius: 16, background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)', padding: 12, display: 'grid', gap: 10 }}>
        <div style={{ fontWeight: 900, color: '#111827' }}>{tt('Недельный тренд')}</div>
        <WeeklyTrendChart
          weeks={weekSeries}
          currentTotals={weeklyTotals}
          previousTotals={previousWeeklyTotals}
          color={mainColor}
          tt={tt}
        />

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#111827', fontWeight: 700 }}>
            <span style={{ width: 18, height: 0, borderTop: `3px solid ${mainColor}`, borderRadius: 999 }} />
            <span>{tt('Текущий период')}</span>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#4b5563', fontWeight: 700 }}>
            <span style={{ width: 18, height: 0, borderTop: '2px dashed #94a3b8', borderRadius: 999 }} />
            <span>{tt('Прошлый период')}</span>
          </div>
        </div>
      </section>

      <ActivityRhythm data={rhythmData} color={mainColor} tt={tt} localeTag={localeTag} />

      <section
        style={{
          border: '1px solid #dbe4ff',
          borderRadius: 16,
          background: 'linear-gradient(180deg, #ffffff 0%, #f8fbff 100%)',
          padding: 12,
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        }}
      >
        <StatCard
          label={tt('Лучший день')}
          value={records.bestDay ? `${records.bestDay.total}` : '—'}
          hint={records.bestDay ? new Date(`${records.bestDay.key}T00:00:00`).toLocaleDateString(localeTag) : undefined}
          accentColor="#2563eb"
        />
        <StatCard
          label={tt('Лучшая неделя')}
          value={records.bestWeek ? `${records.bestWeek.total}` : '—'}
          hint={records.bestWeek ? formatWeekRange(new Date(`${records.bestWeek.key}T00:00:00`)) : undefined}
          accentColor="#14b8a6"
        />
        <StatCard
          label={tt('Лучший подход')}
          value={records.bestSet ? records.bestSet.reps : '—'}
          hint={records.bestSet ? getWorkoutDate(records.bestSet).toLocaleDateString(localeTag) : undefined}
          accentColor="#f97316"
        />
        <StatCard
          label={tt('Последняя тренировка')}
          value={records.lastWorkout ? records.lastWorkout.reps : '—'}
          hint={records.lastWorkout ? getWorkoutDate(records.lastWorkout).toLocaleString(localeTag) : undefined}
          accentColor="#8b5cf6"
        />
      </section>
    </div>
  );
}
