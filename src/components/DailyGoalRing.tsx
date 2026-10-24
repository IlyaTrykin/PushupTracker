'use client';

import Link from 'next/link';
import type React from 'react';
import { dailyGoalProgress, formatGoalPoints } from '@/lib/daily-goal';
import { dailyGoalMessages, fillDailyGoalText } from '@/i18n/messages/features/daily-goal';
import { dashboardLiteMessages } from '@/i18n/messages/features/dashboard-lite';
import { InfoButton } from '@/components/ui';
import type { Locale } from '@/i18n/locale';

const SIZE = 60;
const STROKE = 7;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Раздел «Тренировки» профиля, где задаётся цель дня (R10.1). */
export const SET_GOAL_HREF = '/profile?section=training';

/**
 * Плитка «Цель дня» на дашборде (R10, F1): кольцо «X из Y баллов». `goalPoints === undefined` —
 * профиль ещё не загружен (пустая плитка того же размера); `null` — цели нет: приглашение
 * «Поставить цель» в «Профиль → Тренировки», пояснение под «i».
 */
export default function DailyGoalRing({
  donePoints,
  goalPoints,
  locale,
  className,
}: {
  donePoints: number;
  goalPoints: number | null | undefined;
  locale: Locale;
  className?: string;
}) {
  const goalText = dailyGoalMessages[locale];
  const text = dashboardLiteMessages[locale];

  if (goalPoints === undefined) {
    return (
      <div className={className} aria-busy="true">
        <div style={label}>{text.goalTile}</div>
        <div style={placeholder} aria-hidden="true">—</div>
      </div>
    );
  }

  if (goalPoints === null || goalPoints <= 0) {
    return (
      <div className={className} style={setGoalTile}>
        <div style={labelRow}>
          <span style={label}>{text.goalTile}</span>
          <InfoButton title={text.setGoalInfoTitle}>{goalText.setGoalHint}. {goalText.sectionHint}</InfoButton>
        </div>
        <Link href={SET_GOAL_HREF} style={setGoalLink} prefetch={false} data-testid="dashboard-set-goal">
          <span style={setGoalIcon} aria-hidden="true">🎯</span>
          <span>{text.setGoal}</span>
        </Link>
      </div>
    );
  }

  const progress = dailyGoalProgress(donePoints, goalPoints);
  const offset = CIRCUMFERENCE * (1 - progress.percent / 100);
  const color = progress.reached ? '#16a34a' : '#f97316';
  const done = formatGoalPoints(progress.done, locale);
  const goal = formatGoalPoints(progress.goal, locale);
  const caption = progress.reached ? goalText.ringReached : fillDailyGoalText(goalText.ringProgress, { done, goal });

  return (
    <div className={className} role="group" aria-label={`${text.goalTile}: ${caption}`} data-testid="dashboard-goal-ring">
      <div style={label}>{text.goalTile}</div>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={{ justifySelf: 'center' }}>
        <circle cx={SIZE / 2} cy={SIZE / 2} r={RADIUS} fill="none" stroke="rgba(148, 163, 184, 0.24)" strokeWidth={STROKE} />
        <circle
          cx={SIZE / 2}
          cy={SIZE / 2}
          r={RADIUS}
          fill="none"
          stroke={color}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
          style={{ transition: 'stroke-dashoffset 300ms ease' }}
        />
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" style={ringPercent}>
          {progress.reached ? '✓' : `${progress.percent}%`}
        </text>
      </svg>
      <div style={{ ...ringCaption, color: progress.reached ? '#15803d' : '#475569' }}>
        {progress.reached ? `${goal} · ${text.goalReached}` : text.goalProgress.replace('{done}', done).replace('{goal}', goal)}
      </div>
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: '#64748b',
  lineHeight: 1.15,
};

const labelRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
};

const placeholder: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 900,
  color: '#cbd5e1',
};

const ringPercent: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 900,
  fill: '#0f172a',
};

const ringCaption: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  lineHeight: 1.15,
  fontVariantNumeric: 'tabular-nums',
};

const setGoalTile: React.CSSProperties = {
  borderStyle: 'dashed',
  borderColor: 'rgba(148, 163, 184, 0.5)',
};

const setGoalLink: React.CSSProperties = {
  display: 'grid',
  justifyItems: 'center',
  alignContent: 'center',
  gap: 4,
  minHeight: 44,
  color: '#0f172a',
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1.15,
  textDecoration: 'none',
};

const setGoalIcon: React.CSSProperties = { fontSize: 22, lineHeight: 1 };
