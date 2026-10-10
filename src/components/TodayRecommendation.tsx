'use client';

import type React from 'react';
import { formatDistance } from '@/lib/exercise-metrics';
import type { TodayRecommendation as Recommendation } from '@/lib/recommendation';
import { recommendationMessages } from '@/i18n/messages/features/recommendation';
import type { Locale } from '@/i18n/locale';

function formatPlan(plan: Recommendation, locale: Locale): string {
  const text = recommendationMessages[locale];
  if (plan.unit === 'distance') {
    const one = formatDistance(plan.perSet, locale);
    return plan.sets > 1 ? `${plan.sets} × ${one}` : one;
  }
  const value = plan.unit === 'seconds' ? `${plan.perSet} ${text.seconds}` : String(plan.perSet);
  return `${plan.sets} × ${value}`;
}

/** «Рекомендация на сегодня: 4 × 22» for the selected exercise (F12); `null` — an invitation. */
export default function TodayRecommendation({
  recommendation,
  exerciseName,
  locale,
}: {
  recommendation: Recommendation | null;
  exerciseName: string;
  locale: Locale;
}) {
  const text = recommendationMessages[locale];

  return (
    <div style={card} role="group" aria-label={text.title}>
      <span style={icon} aria-hidden="true">{!recommendation ? '💡' : recommendation.kind === 'deload' ? '🧘' : '📈'}</span>
      <div style={{ display: 'grid', gap: 3, minWidth: 0 }}>
        <div style={eyebrow}>{text.title} · {exerciseName}</div>
        {recommendation ? (
          <>
            <div style={plan}>{formatPlan(recommendation, locale)}</div>
            <div style={caption}>{recommendation.kind === 'deload' ? text.deloadHint : text.growHint}</div>
          </>
        ) : (
          <div style={emptyText}>{text.empty}</div>
        )}
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

const icon: React.CSSProperties = {
  flex: '0 0 auto',
  width: 44,
  height: 44,
  borderRadius: 14,
  display: 'grid',
  placeItems: 'center',
  fontSize: 22,
  background: 'rgba(59, 130, 246, 0.1)',
};

const eyebrow: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#1d4ed8',
  overflowWrap: 'anywhere',
};

const plan: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  lineHeight: 1.1,
  color: '#0f172a',
};

const caption: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: '#64748b',
};

const emptyText: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  color: '#334155',
};
