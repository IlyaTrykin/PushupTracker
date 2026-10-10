'use client';

import Link from 'next/link';
import type React from 'react';
import { dailyGoalProgress, formatGoalPoints } from '@/lib/daily-goal';
import { dailyGoalMessages, fillDailyGoalText } from '@/i18n/messages/features/daily-goal';
import type { Locale } from '@/i18n/locale';

const SIZE = 72;
const STROKE = 8;
const RADIUS = (SIZE - STROKE) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * «Сегодня X из Y баллов» ring of the daily goal (F1). `goalPoints === undefined` — not
 * loaded yet (renders nothing); `null` — no goal: a quiet «Поставить цель» link.
 */
export default function DailyGoalRing({
  donePoints,
  goalPoints,
  locale,
}: {
  donePoints: number;
  goalPoints: number | null | undefined;
  locale: Locale;
}) {
  const text = dailyGoalMessages[locale];
  if (goalPoints === undefined) return null;

  if (goalPoints === null || goalPoints <= 0) {
    return (
      <Link href="/profile#daily-goal" style={setGoalCard} prefetch={false}>
        <span style={setGoalIcon} aria-hidden="true">🎯</span>
        <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <span style={setGoalTitle}>{text.setGoal}</span>
          <span style={setGoalHint}>{text.setGoalHint}</span>
        </span>
      </Link>
    );
  }

  const progress = dailyGoalProgress(donePoints, goalPoints);
  const offset = CIRCUMFERENCE * (1 - progress.percent / 100);
  const color = progress.reached ? '#16a34a' : '#f97316';
  const done = formatGoalPoints(progress.done, locale);
  const goal = formatGoalPoints(progress.goal, locale);

  return (
    <div style={card} role="group" aria-label={text.ringTitle}>
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true" style={{ flex: '0 0 auto' }}>
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
      <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
        <div style={eyebrow}>{text.ringTitle}</div>
        <div style={{ ...headline, color: progress.reached ? '#15803d' : '#0f172a' }}>
          {progress.reached ? text.ringReached : fillDailyGoalText(text.ringRemaining, { remaining: formatGoalPoints(progress.remaining, locale) })}
        </div>
        <div style={caption}>{fillDailyGoalText(text.ringProgress, { done, goal })}</div>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  minWidth: 0,
  padding: '12px 14px',
  borderRadius: 22,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'rgba(255, 255, 255, 0.64)',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.08)',
};

const ringPercent: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 900,
  fill: '#0f172a',
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#c2410c',
};

const headline: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 900,
  lineHeight: 1.15,
};

const caption: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#64748b',
};

const setGoalCard: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
  padding: '12px 14px',
  borderRadius: 22,
  border: '1px dashed rgba(148, 163, 184, 0.5)',
  background: 'rgba(255, 255, 255, 0.4)',
  color: '#334155',
  textDecoration: 'none',
};

const setGoalIcon: React.CSSProperties = { fontSize: 22, lineHeight: 1 };

const setGoalTitle: React.CSSProperties = { fontSize: 14, fontWeight: 800, color: '#0f172a' };

const setGoalHint: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#64748b' };
