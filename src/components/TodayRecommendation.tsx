'use client';

import type React from 'react';
import { formatDistance } from '@/lib/exercise-metrics';
import type { TodayRecommendation as Recommendation } from '@/lib/recommendation';
import { recommendationMessages } from '@/i18n/messages/features/recommendation';
import { dashboardLiteMessages } from '@/i18n/messages/features/dashboard-lite';
import { InfoButton } from '@/components/ui';
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

/** «3 × 32 отжимания» для повторов, «планка: 3 × 45 сек» для времени и дистанции. */
function planWithExercise(plan: Recommendation, exerciseName: string, locale: Locale): string {
  const name = exerciseName.toLocaleLowerCase(locale === 'en' ? 'en-US' : 'ru-RU');
  const value = formatPlan(plan, locale);
  return plan.unit === 'reps' ? `${value} ${name}` : `${name}: ${value}`;
}

/**
 * «Рекомендация: 3 × 32 отжимания» одной строкой (R10.2, F12); как она считается — под «i».
 * `null` — данных мало: строка-приглашение остаётся на виду.
 */
export default function TodayRecommendation({
  recommendation,
  exerciseName,
  locale,
}: {
  recommendation: Recommendation | null;
  exerciseName: string;
  locale: Locale;
}) {
  const base = recommendationMessages[locale];
  const text = dashboardLiteMessages[locale];
  const icon = !recommendation ? '💡' : recommendation.kind === 'deload' ? '🧘' : '📈';

  return (
    <div style={line} role="group" aria-label={base.title} data-testid="dashboard-recommendation">
      <span style={iconStyle} aria-hidden="true">{icon}</span>
      <span style={recommendation ? planText : emptyText}>
        {recommendation
          ? text.recommendation.replace('{plan}', planWithExercise(recommendation, exerciseName, locale))
          : text.recommendationEmpty}
      </span>
      <InfoButton title={base.title}>
        {recommendation ? `${recommendation.kind === 'deload' ? base.deloadHint : base.growHint}. ` : ''}
        {text.recommendationInfo}
      </InfoButton>
    </div>
  );
}

const line: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
  padding: '10px 14px',
  borderRadius: 18,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'rgba(255, 255, 255, 0.64)',
  boxShadow: '0 12px 28px rgba(15, 23, 42, 0.06)',
};

const iconStyle: React.CSSProperties = { flex: '0 0 auto', fontSize: 18, lineHeight: 1 };

const planText: React.CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  fontSize: 15,
  fontWeight: 800,
  color: '#0f172a',
  lineHeight: 1.25,
};

const emptyText: React.CSSProperties = {
  ...planText,
  fontWeight: 700,
  color: '#334155',
};
