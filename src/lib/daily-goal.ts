/**
 * Daily goal (F1): the goal in points per day, the reminder time and who gets
 * «осталось N баллов» right now. Pure — the scheduler job `scheduler/jobs/daily-goal.ts`
 * loads users and day points and sends through `notifyUsers`.
 *
 * The day is the user's calendar day in `User.timeZone`; the reminder goes out within
 * [reminder time, +1 h) of that day, once (dedupe key `daily-goal:<userId>:<DayKey>`).
 */
import { dayKeyInZone, normalizeTimeZone, zonedTimeToInstant, type DayKey } from './calendar-day';
import { pointsToTenths, tenthsToPoints } from './exercise-points';
import { dailyGoalMessages, fillDailyGoalText } from '../i18n/messages/features/daily-goal';
import type { LocalizedMessage, NotifyLocale } from './notify';

export const DAILY_GOAL_MIN_POINTS = 10;
export const DAILY_GOAL_MAX_POINTS = 2000;
export const DEFAULT_REMINDER_TIME = '20:00';
export const DAILY_GOAL_REMINDER_WINDOW_MS = 60 * 60 * 1000;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type DailyGoalUser = {
  id: string;
  timeZone: string;
  dailyGoalPoints: number | null;
  dailyReminderTime: string | null;
};

export type DailyGoalReminder = {
  userId: string;
  day: DayKey;
  goal: number;
  done: number;
  remaining: number;
  key: string;
};

export type DailyGoalProgress = { done: number; goal: number; remaining: number; percent: number; reached: boolean };

type Parsed<T> = { ok: true; value: T } | { ok: false };

/** Integer 10–2000, or empty (`null`, `''`) = goal off. */
export function parseDailyGoalPoints(raw: unknown): Parsed<number | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null };
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw.trim()) : NaN;
  if (!Number.isInteger(value) || value < DAILY_GOAL_MIN_POINTS || value > DAILY_GOAL_MAX_POINTS) return { ok: false };
  return { ok: true, value };
}

/** Strict 'HH:MM' (24 h), or empty = default 20:00. */
export function parseReminderTime(raw: unknown): Parsed<string | null> {
  if (raw === null || raw === undefined || (typeof raw === 'string' && raw.trim() === '')) return { ok: true, value: null };
  if (typeof raw !== 'string' || !HHMM_RE.test(raw.trim())) return { ok: false };
  return { ok: true, value: raw.trim() };
}

export function reminderTimeOrDefault(value: string | null | undefined): string {
  return value && HHMM_RE.test(value) ? value : DEFAULT_REMINDER_TIME;
}

/** «Сегодня X из Y»: points rounded to tenths like everywhere else. */
export function dailyGoalProgress(donePoints: number, goalPoints: number): DailyGoalProgress {
  const doneTenths = Math.max(0, pointsToTenths(donePoints));
  const goalTenths = Math.max(0, pointsToTenths(goalPoints));
  const remainingTenths = Math.max(0, goalTenths - doneTenths);
  const percent = goalTenths > 0 ? Math.min(100, Math.floor((doneTenths / goalTenths) * 100)) : 0;
  return {
    done: tenthsToPoints(doneTenths),
    goal: tenthsToPoints(goalTenths),
    remaining: tenthsToPoints(remainingTenths),
    percent,
    reached: goalTenths > 0 && doneTenths >= goalTenths,
  };
}

export function dailyGoalReminderKey(userId: string, day: DayKey): string {
  return `daily-goal:${userId}:${day}`;
}

/** The user's day when `now` is inside today's reminder window, else `null` (no goal → `null`). */
export function dueReminderDay(user: DailyGoalUser, now: Date): DayKey | null {
  if (!user.dailyGoalPoints || user.dailyGoalPoints <= 0) return null;
  const zone = normalizeTimeZone(user.timeZone);
  const day = dayKeyInZone(now, zone);
  const from = zonedTimeToInstant(day, reminderTimeOrDefault(user.dailyReminderTime), zone).getTime();
  const at = now.getTime();
  return at >= from && at < from + DAILY_GOAL_REMINDER_WINDOW_MS ? day : null;
}

/** Who gets «осталось N баллов» now: due users whose points of their day are below the goal. */
export function planDailyGoalReminders(
  users: Iterable<DailyGoalUser>,
  now: Date,
  pointsOf: (userId: string, day: DayKey) => number,
): DailyGoalReminder[] {
  const out: DailyGoalReminder[] = [];
  for (const user of users) {
    const day = dueReminderDay(user, now);
    if (!day || !user.dailyGoalPoints) continue;
    const progress = dailyGoalProgress(pointsOf(user.id, day), user.dailyGoalPoints);
    if (progress.reached) continue;
    out.push({
      userId: user.id,
      day,
      goal: progress.goal,
      done: progress.done,
      remaining: progress.remaining,
      key: dailyGoalReminderKey(user.id, day),
    });
  }
  return out;
}

/** 65 → «65», 0.5 → «0,5» (ru) / «0.5» (en). */
export function formatGoalPoints(points: number, locale: NotifyLocale): string {
  const text = Number.isInteger(points) ? String(points) : points.toFixed(1);
  return locale === 'ru' ? text.replace('.', ',') : text;
}

function pointsWord(points: number, locale: NotifyLocale): string {
  const [one, few, many] = dailyGoalMessages[locale].pointsWords;
  if (!Number.isInteger(points)) return few;
  if (locale === 'en') return points === 1 ? one : many;
  const mod10 = points % 10;
  const mod100 = points % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function dailyGoalReminderMessage(
  locale: NotifyLocale,
  args: { goal: number; done: number; remaining: number },
): LocalizedMessage {
  const text = dailyGoalMessages[locale];
  return {
    title: text.reminderTitle,
    body: fillDailyGoalText(text.reminderBody, {
      remaining: formatGoalPoints(args.remaining, locale),
      pointsWord: pointsWord(args.remaining, locale),
      done: formatGoalPoints(args.done, locale),
      goal: formatGoalPoints(args.goal, locale),
    }),
    link: '/dashboard',
  };
}
