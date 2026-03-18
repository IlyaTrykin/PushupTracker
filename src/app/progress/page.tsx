'use client';

import { createPortal } from 'react-dom';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { PERIOD_OPTIONS } from '@/lib/analytics/constants';
import { buildProgressAnalytics, getExerciseAccent } from '@/lib/analytics/selectors';
import type { Messages } from '@/i18n/messages';
import type {
  AnalyticsValue,
  ExerciseFilter,
  ExerciseType,
  HeatmapCell,
  Insight,
  KpiCard,
  PeriodKey,
  ProgressAnalytics,
  TrendPoint,
  WorkoutRecord,
  WorkoutStructure,
} from '@/lib/analytics/types';
import { fillTemplate, toExerciseType } from '@/lib/analytics/utils';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale } from '@/i18n/translate';

const EXERCISE_OPTIONS: ExerciseFilter[] = ['all', 'pushups', 'pullups', 'squats', 'crunches', 'plank'];

const pageStyle: CSSProperties = {
  '--analytics-accent': '#b45309',
  '--analytics-accent-soft': 'rgba(180, 83, 9, 0.14)',
  maxWidth: 1080,
  margin: '0 auto',
  display: 'grid',
  gap: 14,
} as CSSProperties;

async function fetchJsonSafe<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const payload =
      data && typeof data === 'object'
        ? data as { error?: string; message?: string }
        : null;
    const message = payload?.error || payload?.message || text || `HTTP ${response.status}`;
    throw new Error(message);
  }

  return data as T;
}

function hexToRgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const full = normalized.length === 3 ? normalized.split('').map((char) => char + char).join('') : normalized;
  const red = Number.parseInt(full.slice(0, 2), 16);
  const green = Number.parseInt(full.slice(2, 4), 16);
  const blue = Number.parseInt(full.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function exerciseLabel(type: ExerciseType, progress: Messages['progress']): string {
  if (type === 'pushups') return progress.exercises.pushups;
  if (type === 'pullups') return progress.exercises.pullups;
  if (type === 'crunches') return progress.exercises.crunches;
  if (type === 'squats') return progress.exercises.squats;
  return progress.exercises.plank;
}

function filterLabel(filter: ExerciseFilter, progress: Messages['progress']): string {
  if (filter === 'all') return progress.exercises.all;
  return exerciseLabel(filter, progress);
}

function isEnglishLocale(localeTag: string): boolean {
  return localeTag.toLowerCase().startsWith('en');
}

function formatCompactDuration(value: number, localeTag: string): string {
  const isEnglish = isEnglishLocale(localeTag);
  if (!Number.isFinite(value) || value <= 0) return isEnglish ? '0 sec' : '0 сек';
  if (value < 60) return `${Math.round(value).toLocaleString(localeTag)} ${isEnglish ? 'sec' : 'сек'}`;
  const minutes = Math.floor(value / 60);
  const seconds = Math.round(value % 60);
  if (!seconds) return `${minutes.toLocaleString(localeTag)} ${isEnglish ? 'min' : 'мин'}`;
  return `${minutes.toLocaleString(localeTag)} ${isEnglish ? 'min' : 'мин'} ${seconds.toLocaleString(localeTag)} ${isEnglish ? 'sec' : 'сек'}`;
}

function formatLoadPoints(value: number, localeTag: string): string {
  const isEnglish = isEnglishLocale(localeTag);
  const rounded = Math.round(value * 10) / 10;
  const decimals = Number.isInteger(rounded) ? 0 : 1;
  const absRounded = Math.abs(rounded);
  const suffix = isEnglish
    ? (absRounded === 1 ? 'point' : 'points')
    : Number.isInteger(rounded)
      ? (absRounded % 10 === 1 && absRounded % 100 !== 11 ? 'балл' : absRounded % 10 >= 2 && absRounded % 10 <= 4 && (absRounded % 100 < 12 || absRounded % 100 > 14) ? 'балла' : 'баллов')
      : 'балла';
  return `${rounded.toLocaleString(localeTag, { maximumFractionDigits: decimals })} ${suffix}`;
}

function formatLoadNumber(value: number, localeTag: string): string {
  const rounded = Math.round(value * 10) / 10;
  const decimals = Number.isInteger(rounded) ? 0 : 1;
  return rounded.toLocaleString(localeTag, { maximumFractionDigits: decimals });
}

function formatExerciseMetric(value: number, exercise: ExerciseFilter | ExerciseType, localeTag: string): string {
  if (exercise === 'plank') return formatCompactDuration(value, localeTag);
  return Math.round(value).toLocaleString(localeTag);
}

function getIsoWeekNumber(date: Date): number {
  const copy = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(copy.getUTCFullYear(), 0, 1));
  return Math.ceil((((copy.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function getLastActiveKey<T extends { key: string; value: number }>(items: T[]): string | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].value > 0) return items[index].key;
  }
  return items[items.length - 1]?.key ?? null;
}

function formatMetricValue(
  metric: AnalyticsValue,
  localeTag: string,
  exercise: ExerciseFilter,
  options?: { signed?: boolean },
): string {
  if (metric.value == null) return '—';

  if (metric.kind === 'count') return Math.round(metric.value).toLocaleString(localeTag);
  if (metric.kind === 'duration') return formatCompactDuration(metric.value, localeTag);
  if (metric.kind === 'load') return formatLoadPoints(metric.value, localeTag);
  if (metric.kind === 'percent') {
    const rounded = Math.round(metric.value);
    const sign = options?.signed && rounded > 0 ? '+' : '';
    return `${sign}${rounded.toLocaleString(localeTag)}%`;
  }
  if (metric.kind === 'rate') {
    const rounded = Math.round(metric.value * 10) / 10;
    return `${rounded.toLocaleString(localeTag, { maximumFractionDigits: 1 })}/${isEnglishLocale(localeTag) ? 'min' : 'мин'}`;
  }

  if (exercise !== 'all') return formatExerciseMetric(metric.value, exercise, localeTag);
  return Math.round(metric.value).toLocaleString(localeTag);
}

function formatSeriesValue(value: number, exercise: ExerciseFilter, localeTag: string): string {
  if (exercise === 'all') return formatLoadPoints(value, localeTag);
  return formatExerciseMetric(value, exercise, localeTag);
}

function resolveInsightTone(tone: Insight['tone']) {
  if (tone === 'positive') return { border: '#16a34a', background: '#f0fdf4' };
  if (tone === 'warning') return { border: '#dc2626', background: '#fef2f2' };
  return { border: '#cbd5e1', background: '#f8fafc' };
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section
      style={{
        border: '1px solid #e2e8f0',
        borderRadius: 24,
        background: 'linear-gradient(180deg, #ffffff 0%, #f7fafc 100%)',
        padding: 16,
        display: 'grid',
        gap: 14,
        boxShadow: '0 16px 48px rgba(15, 23, 42, 0.05)',
      }}
    >
      <div style={{ display: 'grid', gap: 4 }}>
        <div style={{ fontSize: 18, fontWeight: 900, color: '#0f172a' }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 13, color: '#475569' }}>{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        border: '1px dashed #cbd5e1',
        borderRadius: 18,
        background: '#f8fafc',
        padding: '18px 16px',
        display: 'grid',
        gap: 4,
      }}
    >
      <div style={{ fontWeight: 800, color: '#0f172a' }}>{title}</div>
      <div style={{ fontSize: 13, color: '#475569' }}>{body}</div>
    </div>
  );
}

function FilterPill({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        borderRadius: 999,
        border: active ? '1px solid var(--analytics-accent)' : '1px solid #cbd5e1',
        background: active ? 'var(--analytics-accent-soft)' : '#fff',
        color: '#0f172a',
        fontWeight: 800,
        padding: '10px 14px',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );
}

function KpiGrid({
  cards,
  localeTag,
  exercise,
}: {
  cards: KpiCard[];
  localeTag: string;
  exercise: ExerciseFilter;
}) {
  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
      {cards.map((card) => (
        <article
          key={card.id}
          style={{
            borderRadius: 20,
            border: `1px solid ${hexToRgba(card.accent, 0.28)}`,
            background: `linear-gradient(180deg, ${hexToRgba(card.accent, 0.12)} 0%, #ffffff 70%)`,
            padding: 14,
            display: 'grid',
            gap: 8,
          }}
        >
          <div style={{ fontSize: 12, letterSpacing: 0.3, fontWeight: 800, color: '#475569' }}>{card.label}</div>
          <div style={{ fontSize: 28, lineHeight: 1, fontWeight: 900, color: '#0f172a' }}>
            {formatMetricValue(card.metric, localeTag, exercise, { signed: card.id === 'periodProgress' })}
          </div>
          {card.comparison?.available && card.id !== 'periodProgress' ? (
            <div style={{ fontSize: 12, color: card.comparison.delta != null && card.comparison.delta >= 0 ? '#15803d' : '#b91c1c', fontWeight: 800 }}>
              {card.id === 'totalVolume' ? 'Δ ' : ''}
              {formatMetricValue({ value: card.comparison.delta, kind: card.metric.kind }, localeTag, exercise, { signed: true })}
            </div>
          ) : null}
          {card.note ? <div style={{ fontSize: 12, color: '#475569' }}>{card.note}</div> : null}
        </article>
      ))}
    </div>
  );
}

function MetricBadge({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div
      style={{
        borderRadius: 16,
        border: `1px solid ${hexToRgba(accent, 0.24)}`,
        background: '#ffffff',
        padding: '10px 12px',
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 11, color: '#64748b', fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 17, color: '#0f172a', fontWeight: 900, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function InfoHint({
  label,
  title,
  body,
}: {
  label: string;
  title: string;
  body: string;
}) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const updatePosition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      const tooltipWidth = 240;
      const viewportPadding = 12;
      const left = Math.min(
        Math.max(viewportPadding, rect.right - tooltipWidth),
        window.innerWidth - tooltipWidth - viewportPadding,
      );
      const top = rect.bottom + 8;
      setPosition({ top, left });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open]);

  return (
    <div style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <button
        type="button"
        ref={buttonRef}
        aria-label={label}
        onClick={() => setOpen((value) => !value)}
        style={{
          width: 18,
          height: 18,
          borderRadius: 999,
          border: '1px solid rgba(15, 23, 42, 0.2)',
          background: '#ffffffcc',
          color: '#0f172a',
          fontSize: 11,
          fontWeight: 900,
          lineHeight: 1,
          padding: 0,
          cursor: 'pointer',
        }}
      >
        i
      </button>
      {open && position && typeof document !== 'undefined'
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                top: position.top,
                left: position.left,
                zIndex: 99999,
                width: 240,
                borderRadius: 14,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                boxShadow: '0 12px 32px rgba(15, 23, 42, 0.12)',
                padding: 12,
                display: 'grid',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 900, color: '#0f172a' }}>{title}</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: '#475569' }}>{body}</div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}

function VolumeChart({
  points,
  accent,
  exercise,
  localeTag,
  labels,
}: {
  points: TrendPoint[];
  accent: string;
  exercise: ExerciseFilter;
  localeTag: string;
  labels: {
    selectedDay: string;
    volume: string;
    sets: string;
  };
}) {
  const [activeKey, setActiveKey] = useState<string | null>(() => getLastActiveKey(points));

  if (!points.length) return null;

  const fallbackKey = getLastActiveKey(points);
  const activePoint = points.find((point) => point.key === activeKey) ?? points.find((point) => point.key === fallbackKey) ?? points[points.length - 1];
  const maxValue = Math.max(1, ...points.map((point) => point.value));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div
        style={{
          overflowX: 'auto',
          paddingBottom: 4,
          borderRadius: 18,
          border: '1px solid #e2e8f0',
          background: '#ffffff',
          padding: '12px 10px 10px',
        }}
      >
        <div style={{ minWidth: Math.max(300, points.length * 26), display: 'flex', gap: 6, alignItems: 'flex-end', height: 220 }}>
          {points.map((point, index) => {
            const barHeight = point.value > 0 ? Math.max(10, Math.round((point.value / maxValue) * 142)) : 6;
            const isActive = activePoint.key === point.key;
            const showLabel = index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 6)) === 0;
            return (
              <button
                key={point.key}
                type="button"
                onClick={() => setActiveKey(point.key)}
                title={`${point.label}: ${formatSeriesValue(point.value, exercise, localeTag)}`}
                style={{
                  width: 20,
                  minWidth: 20,
                  height: '100%',
                  border: 'none',
                  background: 'transparent',
                  padding: 0,
                  display: 'grid',
                  alignItems: 'end',
                  justifyItems: 'center',
                  cursor: 'pointer',
                }}
              >
                <div style={{ height: 170, display: 'flex', alignItems: 'flex-end' }}>
                  <div
                    style={{
                      width: 18,
                      height: barHeight,
                      borderRadius: 999,
                      background: point.value > 0 ? (isActive ? accent : hexToRgba(accent, 0.78)) : '#e2e8f0',
                      outline: isActive ? `2px solid ${hexToRgba(accent, 0.35)}` : 'none',
                      outlineOffset: 2,
                      transition: 'height 120ms ease-out',
                    }}
                  />
                </div>
                <div style={{ fontSize: 9, color: '#64748b', minHeight: 12 }}>{showLabel ? point.label : ''}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <MetricBadge label={labels.selectedDay} value={activePoint.label} accent={accent} />
        <MetricBadge label={labels.volume} value={formatSeriesValue(activePoint.value, exercise, localeTag)} accent={accent} />
        <MetricBadge label={labels.sets} value={activePoint.setCount.toLocaleString(localeTag)} accent={accent} />
      </div>
    </div>
  );
}

function TrendLineChart({
  title,
  points,
  accent,
  localeTag,
  exercise,
  seriesKey,
  emptyBody,
  detailLabels,
}: {
  title: string;
  points: TrendPoint[];
  accent: string;
  localeTag: string;
  exercise: ExerciseFilter;
  seriesKey: 'bestSet' | 'averageSet';
  emptyBody: string;
  detailLabels: {
    date: string;
    value: string;
    average: string;
  };
}) {
  const [activeKey, setActiveKey] = useState<string | null>(points[points.length - 1]?.key ?? null);

  if (!points.length) {
    return <EmptyState title={title} body={emptyBody} />;
  }

  const valueFor = (point: TrendPoint) => (seriesKey === 'bestSet' ? point.bestSet ?? 0 : point.averageSet ?? 0);
  const maxValue = Math.max(1, ...points.map(valueFor));
  const width = Math.max(340, points.length * 54);
  const height = 200;
  const padX = 22;
  const padTop = 18;
  const padBottom = 34;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padTop - padBottom;
  const xFor = (index: number) => (points.length === 1 ? width / 2 : padX + (index / (points.length - 1)) * chartWidth);
  const yFor = (value: number) => padTop + chartHeight - (value / maxValue) * chartHeight;
  const line = points.map((point, index) => `${xFor(index)},${yFor(valueFor(point))}`).join(' ');
  const activePoint = points.find((point) => point.key === activeKey) ?? points[points.length - 1];

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 14, fontWeight: 800, color: '#0f172a' }}>{title}</div>
      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <svg width={width} height={height} role="img" aria-label={title}>
          <defs>
            <linearGradient id={`${seriesKey}-fill`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hexToRgba(accent, 0.24)} />
              <stop offset="100%" stopColor={hexToRgba(accent, 0.02)} />
            </linearGradient>
          </defs>
          {[0, 0.5, 1].map((tick) => {
            const value = maxValue * tick;
            const y = yFor(value);
            return <line key={tick} x1={padX} x2={width - padX} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={1} />;
          })}
          <polyline
            points={`${xFor(0)},${height - padBottom} ${line} ${xFor(points.length - 1)},${height - padBottom}`}
            fill={`url(#${seriesKey}-fill)`}
            stroke="none"
          />
          <polyline points={line} fill="none" stroke={accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          {points.map((point, index) => {
            const value = valueFor(point);
            const isActive = point.key === activePoint.key;
            return (
              <g key={point.key} onClick={() => setActiveKey(point.key)} style={{ cursor: 'pointer' }}>
                <circle cx={xFor(index)} cy={yFor(value)} r={isActive ? 5 : 3.5} fill={accent} />
                <title>{`${point.label}: ${formatSeriesValue(value, exercise, localeTag)}`}</title>
                {(index === 0 || index === points.length - 1 || index % Math.max(1, Math.ceil(points.length / 4)) === 0) ? (
                  <text x={xFor(index)} y={height - 10} textAnchor="middle" fontSize={10} fill="#64748b">
                    {point.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <MetricBadge label={detailLabels.date} value={activePoint.label} accent={accent} />
        <MetricBadge label={seriesKey === 'bestSet' ? detailLabels.value : detailLabels.average} value={formatSeriesValue(valueFor(activePoint), exercise, localeTag)} accent={accent} />
      </div>
    </div>
  );
}

function Heatmap({
  cells,
  accent,
  exercise,
  localeTag,
  labels,
}: {
  cells: HeatmapCell[];
  accent: string;
  exercise: ExerciseFilter;
  localeTag: string;
  labels: {
    weekdays: string[];
    eachSquareDay: string;
    selectedDay: string;
    workload: string;
    less: string;
    more: string;
    noData: string;
  };
}) {
  const [activeKey, setActiveKey] = useState<string | null>(() => getLastActiveKey(cells));

  if (!cells.length) return null;

  const weeks = new Map<number, HeatmapCell[]>();
  for (const cell of cells) {
    const bucket = weeks.get(cell.weekIndex) ?? [];
    bucket.push(cell);
    weeks.set(cell.weekIndex, bucket);
  }

  const columns = Array.from(weeks.values());
  const activeCell = cells.find((cell) => cell.key === activeKey) ?? cells.find((cell) => cell.key === getLastActiveKey(cells)) ?? cells[cells.length - 1];
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ fontSize: 12, color: '#475569' }}>{labels.eachSquareDay}</div>
      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '34px max-content', gap: 8, alignItems: 'start', width: 'max-content' }}>
          <div style={{ display: 'grid', gap: 6, paddingTop: 20 }}>
            {labels.weekdays.map((label) => (
              <div key={label} style={{ height: 16, fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center' }}>
                {label}
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gap: 8 }}>
            <div style={{ display: 'grid', gridAutoFlow: 'column', gap: 6 }}>
              {columns.map((column, columnIndex) => {
                const topCell = column[0] ?? null;
                return (
                  <div key={`month-${columnIndex}`} style={{ width: 16, fontSize: 10, color: '#64748b', textAlign: 'center', minHeight: 12 }}>
                    {topCell ? getIsoWeekNumber(topCell.date) : ''}
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'grid', gridAutoFlow: 'column', gap: 6, width: 'max-content' }}>
              {columns.map((column, columnIndex) => (
                <div key={columnIndex} style={{ display: 'grid', gap: 6 }}>
                  {Array.from({ length: 7 }).map((_, weekday) => {
                    const cell = column.find((item) => item.weekday === weekday);
                    const isActive = cell?.key === activeCell.key;
                    return (
                      <button
                        key={weekday}
                        type="button"
                        onClick={() => {
                          if (cell) setActiveKey(cell.key);
                        }}
                        title={cell ? `${cell.label}: ${formatSeriesValue(cell.value, exercise, localeTag)}` : labels.noData}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: 4,
                          border: isActive ? `1px solid ${accent}` : '1px solid rgba(148, 163, 184, 0.18)',
                          background: cell ? hexToRgba(accent, cell.intensity ? 0.14 + cell.intensity * 0.7 : 0.08) : '#f1f5f9',
                          padding: 0,
                          boxShadow: isActive ? `0 0 0 2px ${hexToRgba(accent, 0.18)}` : 'none',
                        }}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <MetricBadge label={labels.selectedDay} value={activeCell.label} accent={accent} />
        <MetricBadge label={labels.workload} value={formatSeriesValue(activeCell.value, exercise, localeTag)} accent={accent} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 11, color: '#64748b', fontWeight: 700 }}>
          <span>{labels.less}</span>
          {[0.12, 0.28, 0.46, 0.7, 0.94].map((alpha) => (
            <span key={alpha} style={{ width: 14, height: 14, borderRadius: 4, background: hexToRgba(accent, alpha) }} />
          ))}
          <span>{labels.more}</span>
        </div>
      </div>
    </div>
  );
}

function Distribution({
  analytics,
  localeTag,
  emptyState,
  progress,
}: {
  analytics: ProgressAnalytics;
  localeTag: string;
  emptyState: { title: string; body: string };
  progress: Messages['progress'];
}) {
  if (!analytics.distribution.length) {
    return <EmptyState title={emptyState.title} body={emptyState.body} />;
  }

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ height: 18, borderRadius: 999, overflow: 'hidden', display: 'flex', background: '#e2e8f0' }}>
        {analytics.distribution.map((item) => (
          <div
            key={item.exercise}
            style={{
              width: `${Math.max(item.share * 100, 3)}%`,
              background: getExerciseAccent(item.exercise),
            }}
          />
        ))}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {analytics.distribution.map((item) => (
          <div key={item.exercise} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
            <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontWeight: 800, color: '#0f172a' }}>
              <span style={{ width: 10, height: 10, borderRadius: 999, background: getExerciseAccent(item.exercise) }} />
              {exerciseLabel(item.exercise, progress)}
            </div>
            <div style={{ fontSize: 12, color: '#475569' }}>{`${Math.round(item.share * 100)}%`}</div>
            <div style={{ fontSize: 12, color: '#0f172a', fontWeight: 800 }}>
              {formatMetricValue({ value: item.value, kind: 'load' }, localeTag, 'all')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function QualityPanel({
  analytics,
  localeTag,
  exercise,
  insufficientDataLabel,
}: {
  analytics: ProgressAnalytics;
  localeTag: string;
  exercise: ExerciseFilter;
  insufficientDataLabel: string;
}) {
  if (exercise === 'all') return null;

  return (
    <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))' }}>
      {analytics.qualityMetrics.map((metric) => (
        <article
          key={metric.id}
          style={{
            borderRadius: 18,
            border: '1px solid #dbe4f0',
            background: '#ffffff',
            padding: 14,
            display: 'grid',
            gap: 6,
          }}
        >
          <div style={{ fontSize: 12, color: '#64748b', fontWeight: 800 }}>{metric.label}</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#0f172a' }}>
            {metric.state === 'ok' ? formatMetricValue(metric.metric, localeTag, exercise, { signed: false }) : insufficientDataLabel}
          </div>
          <div style={{ fontSize: 12, color: '#475569' }}>{metric.note}</div>
        </article>
      ))}
    </div>
  );
}

function WorkoutStructurePanel({
  workouts,
  selectedWorkoutId,
  onSelectWorkout,
  accent,
  localeTag,
  exercise,
  labels,
}: {
  workouts: WorkoutStructure[];
  selectedWorkoutId: string | null;
  onSelectWorkout: (value: string) => void;
  accent: string;
  localeTag: string;
  exercise: ExerciseFilter;
  labels: {
    emptyTitle: string;
    emptyBody: string;
    bySession: string;
    byDay: string;
    totalVolume: string;
    sets: string;
    duration: string;
    noDuration: string;
    chartAria: string;
  };
}) {
  const selectedWorkout = workouts.find((workout) => workout.id === selectedWorkoutId) ?? workouts[0] ?? null;

  if (!selectedWorkout) {
    return <EmptyState title={labels.emptyTitle} body={labels.emptyBody} />;
  }

  const width = Math.max(320, selectedWorkout.sets.length * 68);
  const height = 220;
  const maxValue = Math.max(1, ...selectedWorkout.sets.map((set) => set.value));

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={selectedWorkout.id}
          onChange={(event) => onSelectWorkout(event.target.value)}
          style={{
            borderRadius: 12,
            border: '1px solid #cbd5e1',
            background: '#fff',
            padding: '10px 12px',
            fontWeight: 700,
            color: '#0f172a',
            minWidth: 220,
          }}
        >
          {workouts.map((workout) => (
            <option key={workout.id} value={workout.id}>
              {`${workout.label} · ${workout.sets.length} ${labels.sets.toLowerCase()}`}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 12, color: '#475569' }}>
          {selectedWorkout.source === 'session' ? labels.bySession : labels.byDay}
        </div>
      </div>

      <div style={{ overflowX: 'auto', paddingBottom: 2 }}>
        <svg width={width} height={height} role="img" aria-label={labels.chartAria}>
          <line x1={24} x2={width - 16} y1={170} y2={170} stroke="#cbd5e1" strokeWidth={1} />
          {selectedWorkout.sets.map((set, index) => {
            const x = 32 + index * 58;
            const barHeight = Math.max(10, Math.round((set.value / maxValue) * 124));
            return (
              <g key={set.id}>
                <rect x={x} y={170 - barHeight} width={32} height={barHeight} rx={12} fill={hexToRgba(accent, 0.88)} />
                <text x={x + 16} y={164 - barHeight} textAnchor="middle" fontSize={10} fill="#0f172a" fontWeight={800}>
                  {set.value}
                </text>
                <text x={x + 16} y={194} textAnchor="middle" fontSize={10} fill="#64748b">
                  {set.index}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
        <MetricBadge label={labels.totalVolume} value={formatSeriesValue(selectedWorkout.total, exercise, localeTag)} accent={accent} />
        <MetricBadge label={labels.sets} value={selectedWorkout.sets.length.toLocaleString(localeTag)} accent={accent} />
        <MetricBadge
          label={labels.duration}
          value={selectedWorkout.durationSeconds ? formatCompactDuration(selectedWorkout.durationSeconds, localeTag) : labels.noDuration}
          accent={accent}
        />
      </div>
    </div>
  );
}

function InsightsPanel({ insights }: { insights: Insight[] }) {
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {insights.map((insight) => {
        const tone = resolveInsightTone(insight.tone);
        return (
          <article
            key={insight.id}
            style={{
              borderRadius: 18,
              border: `1px solid ${tone.border}`,
              background: tone.background,
              padding: '13px 14px',
              color: '#0f172a',
              fontWeight: 700,
              lineHeight: 1.45,
            }}
          >
            {insight.text}
          </article>
        );
      })}
    </div>
  );
}

export default function ProgressPage() {
  const { locale, messages } = useI18n();
  const localeTag = getIntlLocale(locale);
  const progress = messages.progress;
  const [workouts, setWorkouts] = useState<WorkoutRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [exercise, setExercise] = useState<ExerciseFilter>('all');
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetchJsonSafe<WorkoutRecord[] | { items?: WorkoutRecord[] }>('/api/workouts');
        const items = Array.isArray(response) ? response : response?.items ?? [];
        if (!cancelled) setWorkouts(items);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : progress.errorTitle;
        if (!cancelled) setError(message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [progress.errorTitle]);

  const deferredPeriod = useDeferredValue(period);
  const deferredExercise = useDeferredValue(exercise);
  const analytics = useMemo(
    () => buildProgressAnalytics({ workouts, period: deferredPeriod, exercise: deferredExercise, copy: progress }),
    [deferredExercise, deferredPeriod, progress, workouts],
  );
  const accent = useMemo(() => getExerciseAccent(deferredExercise), [deferredExercise]);

  useEffect(() => {
    setSelectedWorkoutId(analytics.selectedWorkoutId);
  }, [analytics.selectedWorkoutId]);

  const headerLabel = filterLabel(deferredExercise, progress);
  const bestSetNote = analytics.bestSetRecord
    ? deferredExercise === 'all'
      ? fillTemplate(progress.header.mixedRecord, {
          exercise: exerciseLabel(toExerciseType(analytics.bestSetRecord.exerciseType), progress),
          value: formatExerciseMetric(analytics.bestSetRecord.reps, toExerciseType(analytics.bestSetRecord.exerciseType), localeTag),
        })
      : fillTemplate(progress.header.lastRecord, {
          value: formatExerciseMetric(analytics.bestSetRecord.reps, deferredExercise, localeTag),
        })
    : progress.header.recordWillAppear;
  const periodLabel =
    deferredPeriod === '7d'
      ? progress.periods.d7
      : deferredPeriod === '90d'
        ? progress.periods.d90
        : deferredPeriod === 'all'
          ? progress.periods.all
          : progress.periods.d30;
  const summaryValue = formatMetricValue(analytics.totalValue, localeTag, deferredExercise);
  const summaryLoadNumber = formatLoadNumber(analytics.totalValue.value ?? 0, localeTag);

  return (
    <div
      className="app-page"
      style={{
        ...pageStyle,
        ['--analytics-accent' as string]: accent,
        ['--analytics-accent-soft' as string]: hexToRgba(accent, 0.12),
      }}
    >
      <Section title={progress.filters}>
        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PERIOD_OPTIONS.map((option) => (
              <FilterPill
                key={option.key}
                active={period === option.key}
                label={
                  option.key === '7d'
                    ? progress.periods.d7
                    : option.key === '90d'
                      ? progress.periods.d90
                      : option.key === 'all'
                        ? progress.periods.all
                        : progress.periods.d30
                }
                onClick={() => startTransition(() => setPeriod(option.key))}
              />
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {EXERCISE_OPTIONS.map((option) => (
              <FilterPill
                key={option}
                active={exercise === option}
                label={filterLabel(option, progress)}
                onClick={() => startTransition(() => setExercise(option))}
              />
            ))}
          </div>
        </div>
      </Section>

      <section
        style={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 28,
          border: `1px solid ${hexToRgba(accent, 0.26)}`,
          background: `linear-gradient(135deg, ${hexToRgba(accent, 0.18)} 0%, #fff8ef 35%, #ffffff 100%)`,
          padding: 18,
          display: 'grid',
          gap: 14,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: -48,
            top: -62,
            width: 180,
            height: 180,
            borderRadius: 999,
            background: hexToRgba(accent, 0.16),
            filter: 'blur(6px)',
          }}
        />
        <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 6 }}>
          <div style={{ display: 'grid', gap: 6 }}>
            <div style={{ fontSize: 13, color: '#475569', fontWeight: 800 }}>{progress.title}</div>
            {deferredExercise === 'all' ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 34, lineHeight: 0.95, fontWeight: 900, color: '#0f172a' }}>{summaryLoadNumber}</div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
                  <span style={{ fontSize: 13, color: '#334155', fontWeight: 800 }}>{progress.header.loadUnit}</span>
                  <InfoHint
                    label={progress.header.loadInfoLabel}
                    title={progress.header.loadInfoTitle}
                    body={progress.header.loadInfoBody}
                  />
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 34, lineHeight: 0.95, fontWeight: 900, color: '#0f172a' }}>{summaryValue}</div>
            )}
            <div style={{ fontSize: 13, color: '#334155' }}>
              {fillTemplate(progress.header.byPeriodAndFilter, {
                period: periodLabel.toLowerCase(),
                filter: headerLabel.toLowerCase(),
              })}
            </div>
          </div>
        </div>

        <div style={{ position: 'relative', zIndex: 1, display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' }}>
          <MetricBadge label={progress.header.bestSet} value={formatMetricValue(analytics.kpis.find((card) => card.id === 'bestSet')?.metric ?? { value: null, kind: 'count' }, localeTag, deferredExercise)} accent={accent} />
          <MetricBadge label={progress.header.activeStreak} value={`${analytics.streakDays.toLocaleString(localeTag)} ${progress.header.daysShort}`} accent={accent} />
          <MetricBadge label={progress.header.recordNote} value={bestSetNote} accent={accent} />
        </div>
      </section>

      {loading ? <EmptyState title={progress.loadingTitle} body={progress.loadingBody} /> : null}
      {error ? <EmptyState title={progress.errorTitle} body={error} /> : null}

      {!loading && !error ? (
        <>
          <Section title={progress.sections.overview}>
            <KpiGrid cards={analytics.kpis} localeTag={localeTag} exercise={deferredExercise} />
          </Section>

          <Section title={progress.sections.volumeByDay} subtitle={progress.chart.tapDay}>
            {analytics.hasDataInRange ? (
              <VolumeChart
                points={analytics.volumeSeries}
                accent={accent}
                exercise={deferredExercise}
                localeTag={localeTag}
                labels={{
                  selectedDay: progress.chart.selectedDay,
                  volume: progress.chart.volume,
                  sets: progress.chart.sets,
                }}
              />
            ) : (
              <EmptyState title={progress.states.noDataPeriodTitle} body={progress.states.noDataPeriodBody} />
            )}
          </Section>

          {deferredExercise !== 'all' ? (
            <Section title={progress.sections.performanceTrend}>
              <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
                <TrendLineChart
                  title={progress.header.bestSet}
                  points={analytics.bestSetSeries}
                  accent={accent}
                  localeTag={localeTag}
                  exercise={deferredExercise}
                  seriesKey="bestSet"
                  emptyBody={progress.states.trendInsufficient}
                  detailLabels={{
                    date: progress.chart.date,
                    value: progress.chart.value,
                    average: progress.chart.average,
                  }}
                />
                <TrendLineChart
                  title={progress.kpi.averageSet}
                  points={analytics.averageSetSeries}
                  accent={accent}
                  localeTag={localeTag}
                  exercise={deferredExercise}
                  seriesKey="averageSet"
                  emptyBody={progress.states.trendInsufficient}
                  detailLabels={{
                    date: progress.chart.date,
                    value: progress.chart.value,
                    average: progress.chart.average,
                  }}
                />
              </div>
            </Section>
          ) : null}

          <Section title={progress.sections.activityCalendar}>
            <Heatmap
              cells={analytics.heatmap}
              accent={accent}
              exercise={deferredExercise}
              localeTag={localeTag}
              labels={{
                weekdays: [
                  progress.weekdays.mon,
                  progress.weekdays.tue,
                  progress.weekdays.wed,
                  progress.weekdays.thu,
                  progress.weekdays.fri,
                  progress.weekdays.sat,
                  progress.weekdays.sun,
                ],
                eachSquareDay: progress.chart.eachSquareDay,
                selectedDay: progress.chart.selectedDay,
                workload: progress.chart.workload,
                less: progress.chart.less,
                more: progress.chart.more,
                noData: progress.states.noDataPeriodTitle,
              }}
            />
          </Section>

          {deferredExercise === 'all' ? (
            <Section title={progress.sections.loadDistribution}>
              <Distribution
                analytics={analytics}
                localeTag={localeTag}
                emptyState={{
                  title: progress.states.distributionEmptyTitle,
                  body: progress.states.distributionEmptyBody,
                }}
                progress={progress}
              />
            </Section>
          ) : (
            <Section title={progress.sections.quality}>
              <QualityPanel
                analytics={analytics}
                localeTag={localeTag}
                exercise={deferredExercise}
                insufficientDataLabel={progress.states.insufficientData}
              />
            </Section>
          )}

          {deferredExercise !== 'all' ? (
            <Section title={progress.sections.workoutStructure}>
              <WorkoutStructurePanel
                workouts={analytics.workouts}
                selectedWorkoutId={selectedWorkoutId}
                onSelectWorkout={setSelectedWorkoutId}
                accent={accent}
                localeTag={localeTag}
                exercise={deferredExercise}
                labels={{
                  emptyTitle: progress.states.structureEmptyTitle,
                  emptyBody: progress.states.structureEmptyBody,
                  bySession: progress.structure.bySession,
                  byDay: progress.structure.byDay,
                  totalVolume: progress.structure.totalVolume,
                  sets: progress.structure.sets,
                  duration: progress.structure.duration,
                  noDuration: progress.states.noDuration,
                  chartAria: progress.structure.chartAria,
                }}
              />
            </Section>
          ) : null}

          <Section title={progress.sections.insights}>
            <InsightsPanel insights={analytics.insights} />
          </Section>
        </>
      ) : null}
    </div>
  );
}
