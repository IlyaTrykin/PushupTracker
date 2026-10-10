/**
 * Weekly summary (F7): the points of the week, the change against the previous week,
 * the best day and the place in the friends league. Pure assembly and text — the job
 * `scheduler/jobs/weekly-summary.ts` loads the data and sends `weekly_summary`.
 */
import { addDays, diffDays, type DayKey } from './calendar-day';
import { dayPointsTotal, workoutDayKey, type DayStatsWorkout } from './day-stats';
import { pointsToTenths, tenthsToPoints } from './exercise-points';
import { formatGoalPoints } from './daily-goal';
import { buildLeague, placeToken, pointsWord, type LeagueEntry } from './league';
import { fillLeagueText, leagueMessages } from '../i18n/messages/features/league';
import type { LocalizedMessage, NotifyLocale } from './notify';

export type WeeklySummary = {
  weekStart: DayKey;
  totalPoints: number;
  previousPoints: number;
  /** Rounded percent against the previous week; `null` when the previous week had no points. */
  changePercent: number | null;
  /** The day of the week with the most points; `null` for an empty week. */
  bestDay: { day: DayKey; points: number } | null;
  /** My place among the friends; `null` when there is nobody to compare with. */
  league: { place: number; total: number } | null;
  /** Any workout in the week or the one before it. */
  hasActivity: boolean;
};

export type WeeklySummaryInput = {
  weekStart: DayKey;
  /** Workouts of the user; days outside the two weeks are ignored. */
  workouts: DayStatsWorkout[];
  league: { meId: string; entries: LeagueEntry[] } | null;
};

export function weeklySummaryKey(userId: string, start: DayKey): string {
  return `weekly-summary:${userId}:${start}`;
}

export function buildWeeklySummary(input: WeeklySummaryInput): WeeklySummary {
  const { weekStart: start } = input;
  const thisWeek: DayStatsWorkout[] = [];
  const previousWeek: DayStatsWorkout[] = [];
  for (const workout of input.workouts) {
    const offset = diffDays(workoutDayKey(workout), start);
    if (offset >= 0 && offset <= 6) thisWeek.push(workout);
    else if (offset >= -7 && offset < 0) previousWeek.push(workout);
  }

  const totalTenths = pointsToTenths(dayPointsTotal(thisWeek));
  const previousTenths = pointsToTenths(dayPointsTotal(previousWeek));

  let bestDay: WeeklySummary['bestDay'] = null;
  for (let i = 0; i < 7; i += 1) {
    const day = addDays(start, i);
    const points = dayPointsTotal(thisWeek.filter((workout) => workoutDayKey(workout) === day));
    if (points > 0 && (!bestDay || points > bestDay.points)) bestDay = { day, points };
  }

  let league: WeeklySummary['league'] = null;
  if (input.league && input.league.entries.length >= 2) {
    const ranked = buildLeague(input.league.entries, input.league.meId);
    if (ranked.myPlace !== null) league = { place: ranked.myPlace, total: ranked.rows.length };
  }

  return {
    weekStart: start,
    totalPoints: tenthsToPoints(totalTenths),
    previousPoints: tenthsToPoints(previousTenths),
    changePercent: previousTenths > 0 ? Math.round(((totalTenths - previousTenths) / previousTenths) * 100) : null,
    bestDay,
    league,
    hasActivity: thisWeek.length + previousWeek.length > 0,
  };
}

function weekdayName(day: DayKey, locale: NotifyLocale): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(locale === 'en' ? 'en-US' : 'ru-RU', { weekday: 'long', timeZone: 'UTC' });
}

/** `weekly_summary`: «За неделю: 120 баллов, на 20% больше, чем на прошлой. Лучший день — среда, 70 баллов. В лиге друзей — 2-е место из 5.» */
export function weeklySummaryMessage(locale: NotifyLocale, summary: WeeklySummary): LocalizedMessage {
  const text = leagueMessages[locale].summary;
  const points = (value: number) => ({ points: formatGoalPoints(value, locale), pointsWord: pointsWord(value, locale) });

  let change: string = text.noPrevious;
  if (summary.changePercent !== null) {
    if (summary.changePercent > 0) change = fillLeagueText(text.changeUp, { percent: summary.changePercent });
    else if (summary.changePercent < 0) change = fillLeagueText(text.changeDown, { percent: -summary.changePercent });
    else change = text.changeSame;
  }

  const sentences = [`${fillLeagueText(text.total, points(summary.totalPoints))}${change}.`];
  if (summary.bestDay) {
    sentences.push(fillLeagueText(text.bestDay, { day: weekdayName(summary.bestDay.day, locale), ...points(summary.bestDay.points) }));
  }
  if (summary.league) {
    sentences.push(fillLeagueText(text.place, { place: placeToken(summary.league.place, locale), total: summary.league.total }));
  }
  return { title: text.title, body: sentences.join(' '), link: '/friends' };
}
