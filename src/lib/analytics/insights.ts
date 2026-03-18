import type { Messages } from '@/i18n/messages';
import { ruMessages } from '@/i18n/messages/ru';
import type { DistributionItem, Insight, ProgressAnalytics } from '@/lib/analytics/types';
import { fillTemplate } from '@/lib/analytics/utils';

type ProgressCopy = Messages['progress'];

function exerciseLabel(exercise: DistributionItem['exercise'], copy: ProgressCopy): string {
  if (exercise === 'pushups') return copy.exercises.pushups;
  if (exercise === 'pullups') return copy.exercises.pullups;
  if (exercise === 'crunches') return copy.exercises.crunches;
  if (exercise === 'squats') return copy.exercises.squats;
  return copy.exercises.plank;
}

function formatPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function buildInsights(
  analytics: ProgressAnalytics,
  copy: ProgressCopy = ruMessages.progress,
): Insight[] {
  const insights: Insight[] = [];
  const totalComparison = analytics.kpis.find((item) => item.id === 'periodProgress')?.comparison ?? null;

  if (totalComparison?.available && totalComparison.percent != null && Math.abs(totalComparison.percent) >= 10) {
    insights.push({
      id: 'volume-change',
      tone: totalComparison.percent > 0 ? 'positive' : 'warning',
      text: fillTemplate(
        totalComparison.percent > 0 ? copy.insights.volumeUp : copy.insights.volumeDown,
        { percent: formatPercent(totalComparison.percent) },
      ),
    });
  }

  if (analytics.filter === 'all' && analytics.distribution.length) {
    const leader = analytics.distribution[0];
    if (leader.share >= 0.4) {
      insights.push({
        id: 'dominant-exercise',
        tone: 'neutral',
        text: fillTemplate(copy.insights.dominantExercise, {
          exercise: exerciseLabel(leader.exercise, copy),
          share: Math.round(leader.share * 100),
        }),
      });
    }
  }

  if (analytics.filter !== 'all' && analytics.bestSetSeries.length >= 2) {
    const first = analytics.bestSetSeries[0]?.bestSet ?? null;
    const last = analytics.bestSetSeries[analytics.bestSetSeries.length - 1]?.bestSet ?? null;
    if (first != null && last != null && last > first) {
      insights.push({
        id: 'best-set-trend',
        tone: 'positive',
        text: fillTemplate(copy.insights.bestSetTrend, { from: first, to: last }),
      });
    }
  }

  if (analytics.streakDays >= 3) {
    insights.push({
      id: 'streak',
      tone: 'positive',
      text: fillTemplate(copy.insights.streak, { days: analytics.streakDays }),
    });
  }

  const fatigue = analytics.qualityMetrics.find((metric) => metric.id === 'fatigueDrop');
  if (fatigue?.state === 'ok' && fatigue.metric.value != null) {
    if (fatigue.metric.value <= 12) {
      insights.push({
        id: 'fatigue-low',
        tone: 'positive',
        text: copy.insights.fatigueLow,
      });
    } else if (fatigue.metric.value >= 25) {
      insights.push({
        id: 'fatigue-high',
        tone: 'warning',
        text: copy.insights.fatigueHigh,
      });
    }
  }

  const heavy = analytics.qualityMetrics.find((metric) => metric.id === 'heavyShare');
  if (heavy?.state === 'ok' && heavy.metric.value != null && heavy.metric.value >= 35) {
    insights.push({
      id: 'heavy-share',
      tone: 'neutral',
      text: fillTemplate(copy.insights.heavyShare, { percent: Math.round(heavy.metric.value) }),
    });
  }

  if (!insights.length) {
    if (analytics.hasDataInRange) {
      insights.push({
        id: 'baseline-volume',
        tone: 'neutral',
        text: fillTemplate(copy.insights.baselineVolume, {
          sets: analytics.totalSets,
          days: analytics.trainingDays,
        }),
      });
    } else {
      insights.push({
        id: 'empty',
        tone: 'neutral',
        text: copy.insights.empty,
      });
    }
  }

  return insights.slice(0, 6);
}
