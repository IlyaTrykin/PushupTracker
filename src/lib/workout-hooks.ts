/**
 * What happens after a workout is created (any source: web, Telegram): personal records and
 * badges (F3). The rules are pure (`achievements.ts`); here they are saved as `UserAchievement`
 * (badges by `uniqueKey`, so each is given once even to parallel requests) and friends are told
 * through `notifyUsers` (`friend_achievement`) without holding the API response.
 */

import {
  detectRecords,
  evaluateBadges,
  friendAchievementMessage,
  type AchievementDto,
  type AchievementWorkout,
  type BadgeCode,
  type RecordHit,
} from './achievements';
import { dayKeyInZone, normalizeTimeZone, type DayKey } from './calendar-day';
import { workoutDayKey } from './day-stats';
import type { LocalizedMessage, NotifyEvent, NotifyLocale, NotifyOptions } from './notify';

export type CreatedWorkout = {
  id: string;
  reps: number;
  loadKg: number | null;
  repsLeft: number | null;
  repsRight: number | null;
  date: Date;
  time: Date;
  exerciseType: string;
  trainingSessionId: string | null;
};

export type WorkoutHookUser = { id: string; username: string; timeZone: string };

export type WorkoutHookResult<R = RecordHit, A = AchievementDto> = { records: R[]; achievements: A[] };

export type AchievementRow = {
  userId: string;
  kind: 'badge' | 'record';
  code: string;
  exerciseType: string | null;
  value: number | null;
  workoutId: string | null;
  uniqueKey: string | null;
};

export type AchievementHookDeps = {
  /** All workouts of the user (the new one included), the daily goal and owned badge codes. */
  loadContext(userId: string): Promise<{ workouts: AchievementWorkout[]; dailyGoalPoints: number | null; ownedBadges: string[] }>;
  /** Inserts a row; `null` when its `uniqueKey` is already taken. */
  saveAchievement(row: AchievementRow): Promise<{ id: string; achievedAt: Date } | null>;
  friendIds(userId: string): Promise<string[]>;
  usernameOf(userId: string): Promise<string | null>;
  notify(
    userIds: string[],
    event: NotifyEvent,
    build: (locale: NotifyLocale, userId: string) => LocalizedMessage,
    opts?: NotifyOptions,
  ): Promise<void>;
  /** Runs a task after the response (errors are logged by the caller of `defer`). */
  defer(task: () => Promise<void>): void;
  now(): Date;
};

export function badgeUniqueKey(code: BadgeCode, userId: string): string {
  return `badge:${code}:${userId}`;
}

function recordUniqueKey(hit: RecordHit, userId: string, workoutId: string, day: DayKey): string {
  // One «Рекорд дня» per exercise and day; a best set belongs to its workout.
  return hit.kind === 'best_day' ? `record:best_day:${userId}:${hit.exerciseType}:${day}` : `record:best_set:${workoutId}`;
}

export function createAchievementHook(deps: AchievementHookDeps) {
  async function saveBadge(userId: string, code: BadgeCode, extra: { exerciseType?: string | null; value?: number | null; workoutId?: string | null }) {
    const row: AchievementRow = {
      userId,
      kind: 'badge',
      code,
      exerciseType: extra.exerciseType ?? null,
      value: extra.value ?? null,
      workoutId: extra.workoutId ?? null,
      uniqueKey: badgeUniqueKey(code, userId),
    };
    const saved = await deps.saveAchievement(row);
    if (!saved) return null;
    const dto: AchievementDto = {
      id: saved.id,
      kind: 'badge',
      code,
      exerciseType: row.exerciseType,
      value: row.value,
      workoutId: row.workoutId,
      achievedAt: saved.achievedAt.toISOString(),
    };
    return dto;
  }

  function tellFriends(userId: string, username: string, records: RecordHit[], badges: BadgeCode[]) {
    if (!records.length && !badges.length) return;
    deps.defer(async () => {
      const friends = (await deps.friendIds(userId)).filter((id) => id !== userId);
      if (!friends.length) return;
      await deps.notify(friends, 'friend_achievement', (locale) => friendAchievementMessage(locale, { username, records, badges }), {
        tag: `friend-achievement-${userId}`,
      });
    });
  }

  async function onWorkoutCreated(workout: CreatedWorkout, user: WorkoutHookUser): Promise<WorkoutHookResult> {
    const context = await deps.loadContext(user.id);
    const today = dayKeyInZone(deps.now(), normalizeTimeZone(user.timeZone));
    const day = workoutDayKey(workout);
    const history = context.workouts.filter((item) => item.id !== workout.id);

    const records: RecordHit[] = [];
    for (const hit of detectRecords(history, workout)) {
      const saved = await deps.saveAchievement({
        userId: user.id,
        kind: 'record',
        code: hit.kind,
        exerciseType: hit.exerciseType,
        value: hit.value,
        workoutId: workout.id,
        uniqueKey: recordUniqueKey(hit, user.id, workout.id, day),
      });
      if (saved) records.push(hit);
    }

    const codes = evaluateBadges({
      workouts: [...history, workout],
      newWorkout: workout,
      today,
      dailyGoalPoints: context.dailyGoalPoints,
      owned: context.ownedBadges,
    });
    const achievements: AchievementDto[] = [];
    for (const code of codes) {
      const dto = await saveBadge(user.id, code, {
        workoutId: workout.id,
        exerciseType: code === 'first_exercise' ? workout.exerciseType : null,
      });
      if (dto) achievements.push(dto);
    }

    tellFriends(user.id, user.username, records, achievements.map((item) => item.code));
    return { records, achievements };
  }

  /** «Первое место в лиге недели» (for the weekly league job): given once; `null` if the user already has it. */
  async function awardLeagueWinner(userId: string, weekStart: DayKey): Promise<AchievementDto | null> {
    void weekStart; // the badge is given once; the week only explains why (the caller's dedupe key)
    const dto = await saveBadge(userId, 'league_winner', {});
    if (dto) {
      const username = await deps.usernameOf(userId);
      if (username) tellFriends(userId, username, [], ['league_winner']);
    }
    return dto;
  }

  return { onWorkoutCreated, awardLeagueWinner };
}

// ---------------------------------------------------------------------------
// Prisma-backed instance
// ---------------------------------------------------------------------------

async function db() {
  return (await import('./prisma')).prisma;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

const prismaDeps: AchievementHookDeps = {
  loadContext: async (userId) => {
    const prisma = await db();
    const [workouts, user, owned] = await Promise.all([
      prisma.workout.findMany({ where: { userId }, select: { id: true, date: true, reps: true, exerciseType: true, loadKg: true } }),
      prisma.user.findUnique({ where: { id: userId }, select: { dailyGoalPoints: true } }),
      prisma.userAchievement.findMany({ where: { userId, kind: 'badge' }, select: { code: true } }),
    ]);
    return { workouts, dailyGoalPoints: user?.dailyGoalPoints ?? null, ownedBadges: owned.map((row) => row.code) };
  },
  saveAchievement: async (row) => {
    const prisma = await db();
    try {
      return await prisma.userAchievement.create({ data: row, select: { id: true, achievedAt: true } });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  },
  friendIds: async (userId) => {
    const prisma = await db();
    const links = await prisma.friendship.findMany({
      where: { status: 'accepted', OR: [{ userId }, { friendId: userId }] },
      select: { userId: true, friendId: true },
    });
    return Array.from(new Set(links.map((link) => (link.userId === userId ? link.friendId : link.userId))));
  },
  usernameOf: async (userId) => {
    const prisma = await db();
    return (await prisma.user.findUnique({ where: { id: userId }, select: { username: true } }))?.username ?? null;
  },
  notify: async (userIds, event, build, opts) => {
    const { notifyUsers } = await import('./notify');
    await notifyUsers(userIds, event, build, opts);
  },
  defer: (task) => {
    void task().catch((error) => console.error('ACHIEVEMENT NOTIFY ERROR:', error instanceof Error ? error.message : error));
  },
  now: () => new Date(),
};

const defaultHook = createAchievementHook(prismaDeps);

/** Records and badges of a new workout; friends are notified in the background. */
export const onWorkoutCreated = defaultHook.onWorkoutCreated;

/** Gives «Первое место в лиге недели» once per user (T13 weekly league). */
export const awardLeagueWinner = defaultHook.awardLeagueWinner;
