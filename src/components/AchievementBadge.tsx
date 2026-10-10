'use client';

import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { achievementsMessages } from '@/i18n/messages/features/achievements';
import { badgeTitle, type WorkoutAchievementMarks } from '@/lib/achievements';

type Locale = 'ru' | 'en';
type Mark = WorkoutAchievementMarks[string];

const CHUNK = 100;

/**
 * Records and badges earned by the given workouts (`GET /api/achievements/workouts`),
 * for the 🏆 mark in friend and group feeds. Failures leave the feed as it was.
 */
export function useWorkoutAchievementMarks(workoutIds: string[]): WorkoutAchievementMarks {
  const [marks, setMarks] = useState<WorkoutAchievementMarks>({});
  const key = useMemo(() => Array.from(new Set(workoutIds.filter(Boolean))).sort().join(','), [workoutIds]);

  useEffect(() => {
    if (!key) return;
    const ids = key.split(',');
    let cancelled = false;
    void (async () => {
      const next: WorkoutAchievementMarks = {};
      for (let i = 0; i < ids.length; i += CHUNK) {
        try {
          const response = await fetch(`/api/achievements/workouts?ids=${encodeURIComponent(ids.slice(i, i + CHUNK).join(','))}`);
          if (!response.ok) continue;
          const data: unknown = await response.json();
          if (data && typeof data === 'object') Object.assign(next, data);
        } catch {
          // offline or the server is busy — the feed just shows no marks
        }
      }
      if (!cancelled) setMarks((prev) => ({ ...prev, ...next }));
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return marks;
}

function markLabel(mark: Mark, locale: Locale): string {
  const text = achievementsMessages[locale];
  const parts = [
    ...mark.records.map((kind) => (kind === 'best_set' ? text.toastBestSet : text.toastBestDay)),
    ...mark.badges.map((code) => badgeTitle(code, locale)),
  ];
  return parts.length ? parts.join(' · ') : text.feedMark;
}

/** 🏆 next to a workout that set a record or earned a badge; nothing otherwise. */
export default function AchievementBadge({ mark, locale, style }: { mark?: Mark; locale: Locale; style?: CSSProperties }) {
  if (!mark || (!mark.records.length && !mark.badges.length)) return null;
  const label = markLabel(mark, locale);
  return (
    <span role="img" aria-label={label} title={label} style={{ ...badgeStyle, ...style }}>
      🏆
    </span>
  );
}

const badgeStyle: CSSProperties = {
  display: 'inline-block',
  fontSize: 16,
  lineHeight: 1,
  marginRight: 4,
  verticalAlign: 'middle',
};
