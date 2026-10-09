// Подсчёт челленджей и их календарь — чистые функции, общие для сервера
// (`/api/challenges/[id]`, ранги в `/api/workouts`) и страниц челленджей.
//
// Правила (B09, B10):
// - даты челленджа — календарные дни (`startDate`/`endDate` хранятся как полночь UTC,
//   как `Workout.date`); последний день идёт целиком, «завершён» — со следующего дня;
// - упражнения с весом сравниваются в баллах (`calculateExercisePoints`), иначе 20 повторов
//   с 8 кг равнялись бы 20 повторам с 32 кг;
// - `sets_min` для упражнений на одну руку/ногу засчитывает подход по слабейшей стороне.
import { addDays, dbDateToDayKey, diffDays, parseDayKey, type DayKey } from '@/lib/calendar-day';
import { pointsToTenths, tenthsToPoints, calculateExercisePoints } from '@/lib/exercise-points';
import { isLoadedExercise, isUnilateralExercise } from '@/lib/exercises';

export const CHALLENGE_NAME_MAX_LENGTH = 80;
export const CHALLENGE_PARTICIPANTS_MAX = 50; // включая создателя
export const CHALLENGE_CREATE_LIMIT_PER_DAY = 20;

export type ChallengeMode = 'most' | 'target' | 'daily_min' | 'sets_min';
export const CHALLENGE_MODES: readonly ChallengeMode[] = ['most', 'target', 'daily_min', 'sets_min'];

export function isChallengeMode(value: unknown): value is ChallengeMode {
  return typeof value === 'string' && (CHALLENGE_MODES as readonly string[]).includes(value);
}

export type ChallengeWorkoutRow = {
  userId: string;
  date: Date | string;
  reps: number;
  loadKg?: number | null;
  repsLeft?: number | null;
  repsRight?: number | null;
};

export type ChallengeScoreRow = {
  userId: string;
  total: number;
  creditedDays?: number;
  totalDays?: number;
  qualifiedSets?: number;
  qualifiedReps?: number;
};

export type ChallengeDayStatus = { upcoming: boolean; active: boolean; finished: boolean; daysLeft: number };

/** Календарный день из `Challenge.startDate/endDate` или `Workout.date` (ISO-строка или Date) — по UTC-частям. */
export function challengeDayKey(value: string | Date): DayKey {
  if (value instanceof Date) return dbDateToDayKey(value);
  const head = String(value).slice(0, 10);
  return parseDayKey(head) ?? dbDateToDayKey(new Date(value));
}

/** Статус по дням: последний день челленджа — ещё «идёт». `today` — день пользователя. */
export function challengeDayStatus(start: string | Date, end: string | Date, today: DayKey): ChallengeDayStatus {
  const startKey = challengeDayKey(start);
  const endKey = challengeDayKey(end);
  const upcoming = diffDays(today, startKey) < 0;
  const finished = diffDays(today, endKey) > 0;
  const daysLeft = finished ? 0 : Math.max(0, diffDays(endKey, upcoming ? addDays(startKey, -1) : today));
  return { upcoming, active: !upcoming && !finished, finished, daysLeft };
}

export function challengeTotalDays(start: string | Date, end: string | Date): number {
  const diff = diffDays(challengeDayKey(end), challengeDayKey(start));
  return diff >= 0 ? diff + 1 : 0;
}

/** Дата для показа без сдвига часового пояса: день берётся как есть и форматируется в UTC. */
export function formatChallengeDay(value: string | Date, localeTag: string): string {
  const key = challengeDayKey(value);
  return new Date(`${key}T00:00:00.000Z`).toLocaleDateString(localeTag, { timeZone: 'UTC' });
}

/** Упражнения с весом сравниваются в баллах, остальные — в повторах/секундах. */
export function challengeUsesPoints(exerciseType: string): boolean {
  return isLoadedExercise(exerciseType);
}

function valueTenths(exerciseType: string, workout: ChallengeWorkoutRow): number {
  if (challengeUsesPoints(exerciseType)) {
    return pointsToTenths(calculateExercisePoints(workout.reps, exerciseType, workout.loadKg ?? null));
  }
  return Math.max(0, Math.round(Number(workout.reps) || 0)) * 10;
}

/** Вклад одной записи в «кто больше»/«цель»/«минимум в день»: баллы для упражнений с весом, иначе повторы. */
export function workoutChallengeValue(exerciseType: string, workout: ChallengeWorkoutRow): number {
  return tenthsToPoints(valueTenths(exerciseType, workout));
}

/** Размер подхода для `sets_min`: у односторонних — слабейшая сторона (без раскладки — не больше половины). */
export function setChallengeValue(exerciseType: string, workout: ChallengeWorkoutRow): number {
  const reps = Math.max(0, Number(workout.reps) || 0);
  if (!isUnilateralExercise(exerciseType)) return reps;
  if (workout.repsLeft != null && workout.repsRight != null) return Math.min(workout.repsLeft, workout.repsRight);
  return Math.floor(reps / 2);
}

/**
 * Таблица челленджа. `workouts` — записи нужного упражнения за период челленджа
 * (фильтрует вызывающий); записи не-участников игнорируются. Порядок — по убыванию.
 */
export function scoreChallenge(input: {
  mode: ChallengeMode | string;
  exerciseType: string;
  targetReps: number | null;
  participantIds: string[];
  workouts: ChallengeWorkoutRow[];
  totalDays: number;
}): ChallengeScoreRow[] {
  const { mode, exerciseType, participantIds, workouts, totalDays } = input;
  const threshold = Number(input.targetReps ?? 0);
  const participants = new Set(participantIds);
  const mine = workouts.filter((w) => participants.has(w.userId));

  if (mode === 'daily_min') {
    const byDay = new Map<string, number>(); // `${userId}|${day}` → tenths
    for (const w of mine) {
      const key = `${w.userId}|${challengeDayKey(w.date)}`;
      byDay.set(key, (byDay.get(key) ?? 0) + valueTenths(exerciseType, w));
    }
    const credited = new Map<string, number>();
    for (const [key, tenths] of byDay) {
      if (tenths >= threshold * 10) {
        const userId = key.slice(0, key.indexOf('|'));
        credited.set(userId, (credited.get(userId) ?? 0) + 1);
      }
    }
    return participantIds
      .map((userId) => {
        const days = credited.get(userId) ?? 0;
        return { userId, total: days, creditedDays: days, totalDays };
      })
      .sort((a, b) => b.total - a.total);
  }

  if (mode === 'sets_min') {
    const stats = new Map<string, { sets: number; reps: number }>();
    for (const w of mine) {
      if (setChallengeValue(exerciseType, w) < threshold) continue;
      const current = stats.get(w.userId) ?? { sets: 0, reps: 0 };
      current.sets += 1;
      current.reps += Math.max(0, Number(w.reps) || 0);
      stats.set(w.userId, current);
    }
    return participantIds
      .map((userId) => {
        const v = stats.get(userId) ?? { sets: 0, reps: 0 };
        return { userId, total: v.sets, qualifiedSets: v.sets, qualifiedReps: v.reps };
      })
      .sort((a, b) => b.total - a.total || (b.qualifiedReps ?? 0) - (a.qualifiedReps ?? 0));
  }

  const totals = new Map<string, number>();
  for (const w of mine) totals.set(w.userId, (totals.get(w.userId) ?? 0) + valueTenths(exerciseType, w));
  return participantIds
    .map((userId) => ({ userId, total: tenthsToPoints(totals.get(userId) ?? 0) }))
    .sort((a, b) => b.total - a.total);
}

/**
 * Кого из запрошенных можно пригласить: только друзей создателя. Неизвестные ники
 * попадают в тот же список «не друзья», чтобы ответ не раскрывал, какие ники существуют.
 */
export function splitChallengeInvitees(
  requested: string[],
  friendUsernames: string[],
  creatorUsername: string,
): { invited: string[]; notFriends: string[] } {
  const friends = new Set(friendUsernames);
  const invited: string[] = [];
  const notFriends: string[] = [];
  const seen = new Set<string>([creatorUsername]);
  for (const raw of requested) {
    const username = String(raw ?? '').trim();
    if (!username || seen.has(username)) continue;
    seen.add(username);
    (friends.has(username) ? invited : notFriends).push(username);
  }
  return { invited, notFriends };
}
