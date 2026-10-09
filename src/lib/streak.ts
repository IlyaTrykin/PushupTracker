/**
 * The single streak rule of the app.
 *
 * A streak is a run of active calendar days. It is alive while the last active
 * day is today or yesterday; missed days inside the run (and between the last
 * active day and today) can be covered by a freeze — at most `freezePerWeek`
 * missed days per calendar week (Monday–Sunday). Today never counts as missed:
 * the user still has time. Frozen days keep the run alive but do not add to it.
 */

import { addDays, diffDays, parseDayKey, weekStart, type DayKey } from './calendar-day';

export type StreakResult = {
  current: number;
  best: number;
  /** A freeze covers a day of today's week in the current streak. */
  freezeUsedThisWeek: boolean;
  /** Missed days covered by a freeze in the current streak, oldest first. */
  frozenDays: DayKey[];
};

export function computeStreak(
  activeDays: Iterable<DayKey>,
  today: DayKey,
  opts?: { freezePerWeek?: number },
): StreakResult {
  const freezePerWeek = Math.max(0, Math.trunc(opts?.freezePerWeek ?? 1));

  const active = new Set<DayKey>();
  for (const raw of activeDays) {
    const key = parseDayKey(raw);
    if (key && diffDays(key, today) <= 0) active.add(key);
  }

  const empty: StreakResult = { current: 0, best: 0, freezeUsedThisWeek: false, frozenDays: [] };
  if (active.size === 0) return empty;

  const first = [...active].sort()[0];
  const usedPerWeek = new Map<DayKey, number>(); // freezes spent by the current run, per week
  let run = 0;
  let best = 0;
  let runFrozen: DayKey[] = []; // committed frozen days of the current run
  let pending: DayKey[] = []; // missed days waiting for the next active day

  const pendingInWeek = (week: DayKey) => pending.filter((day) => weekStart(day) === week).length;

  for (let day = first; diffDays(day, today) <= 0; day = addDays(day, 1)) {
    if (active.has(day)) {
      for (const frozen of pending) {
        const week = weekStart(frozen);
        usedPerWeek.set(week, (usedPerWeek.get(week) ?? 0) + 1);
      }
      runFrozen = runFrozen.concat(pending);
      pending = [];
      run += 1;
      best = Math.max(best, run);
      continue;
    }

    if (day === today || run === 0) continue;

    const week = weekStart(day);
    if ((usedPerWeek.get(week) ?? 0) + pendingInWeek(week) < freezePerWeek) {
      pending.push(day);
    } else {
      run = 0;
      runFrozen = [];
      pending = [];
      usedPerWeek.clear();
    }
  }

  if (run === 0) return { ...empty, best };

  const frozenDays = runFrozen.concat(pending);
  const thisWeek = weekStart(today);
  return {
    current: run,
    best,
    freezeUsedThisWeek: frozenDays.some((day) => weekStart(day) === thisWeek),
    frozenDays,
  };
}
