import { dbDateToDayKey, parseDayKey, type DayKey } from './calendar-day';
import { calculateExercisePoints, pointsToTenths, tenthsToPoints } from './exercise-points';
import { isExerciseType } from './exercises';

export const GROUP_GOAL_TITLE_MAX_LENGTH = 80;
export const GROUP_GOAL_MIN_POINTS = 100;
export const GROUP_GOAL_MAX_POINTS = 10_000_000;

export type GroupGoalProgressInput = {
  targetPoints: number;
  /** null — every exercise counts. */
  exerciseType: string | null;
  /** Calendar days stored as UTC midnight (the Workout.date convention). */
  startDate: Date;
  endDate: Date;
};
export type GroupGoalWorkout = { userId: string; date: Date; exerciseType: string; reps: number; loadKg: number | null };
export type GroupGoalMember = { userId: string; username: string; includeInStats: boolean; status: string };
export type GroupGoalContribution = { userId: string; username: string; points: number };
export type GroupGoalProgress = {
  totalPoints: number;
  /** Whole percent, 0..100; 100 only once the target is reached. */
  percent: number;
  reached: boolean;
  /** Members with points, biggest first. */
  contributions: GroupGoalContribution[];
};

/** Points of active, stats-included members over the goal's calendar days (both ends inclusive). */
export function computeGroupGoalProgress(
  goal: GroupGoalProgressInput,
  workouts: GroupGoalWorkout[],
  members: GroupGoalMember[],
): GroupGoalProgress {
  const counted = new Map(members.filter((m) => m.status === 'active' && m.includeInStats).map((m) => [m.userId, m]));
  const start = dbDateToDayKey(goal.startDate);
  const end = dbDateToDayKey(goal.endDate);
  const tenths = new Map<string, number>();

  for (const workout of workouts) {
    if (!counted.has(workout.userId)) continue;
    if (goal.exerciseType && workout.exerciseType !== goal.exerciseType) continue;
    const key = dbDateToDayKey(workout.date);
    if (key < start || key > end) continue;
    const points = calculateExercisePoints(workout.reps, workout.exerciseType, workout.loadKg);
    tenths.set(workout.userId, (tenths.get(workout.userId) ?? 0) + pointsToTenths(points));
  }

  const contributions = Array.from(tenths, ([userId, value]) => ({
    userId,
    username: counted.get(userId)!.username,
    points: tenthsToPoints(value),
  }))
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points || a.username.localeCompare(b.username));

  const totalTenths = Array.from(tenths.values()).reduce((sum, v) => sum + v, 0);
  const totalPoints = tenthsToPoints(totalTenths);
  const reached = goal.targetPoints > 0 && totalPoints >= goal.targetPoints;
  const percent = reached ? 100 : Math.max(0, Math.min(99, Math.floor((totalPoints / goal.targetPoints) * 100)));
  return { totalPoints, percent, reached, contributions };
}

export type GroupGoalInput = {
  title: string;
  targetPoints: number;
  exerciseType: string | null;
  startDay: DayKey;
  endDay: DayKey;
};
export type GroupGoalInputResult =
  | { ok: true; value: GroupGoalInput }
  | { ok: false; code: 'GOAL_TITLE_INVALID' | 'GOAL_POINTS_INVALID' | 'GOAL_EXERCISE_INVALID' | 'GOAL_DATE_INVALID' };

export function parseGroupGoalInput(raw: unknown): GroupGoalInputResult {
  const body = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title || title.length > GROUP_GOAL_TITLE_MAX_LENGTH) return { ok: false, code: 'GOAL_TITLE_INVALID' };

  const targetPoints = body.targetPoints;
  if (
    typeof targetPoints !== 'number' || !Number.isInteger(targetPoints) ||
    targetPoints < GROUP_GOAL_MIN_POINTS || targetPoints > GROUP_GOAL_MAX_POINTS
  ) {
    return { ok: false, code: 'GOAL_POINTS_INVALID' };
  }

  const rawExercise = typeof body.exerciseType === 'string' ? body.exerciseType.trim() : 'all';
  if (rawExercise !== 'all' && !isExerciseType(rawExercise)) return { ok: false, code: 'GOAL_EXERCISE_INVALID' };

  const startDay = parseDayKey(body.startDate);
  const endDay = parseDayKey(body.endDate);
  if (!startDay || !endDay || endDay < startDay) return { ok: false, code: 'GOAL_DATE_INVALID' };

  return {
    ok: true,
    value: { title, targetPoints, exerciseType: rawExercise === 'all' ? null : rawExercise, startDay, endDay },
  };
}

// ---------------------------------------------------------------- database part

export type GroupGoalRecord = {
  id: string;
  groupId: string;
  title: string;
  targetPoints: number;
  exerciseType: string | null;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  completedAt: Date | null;
  deletedAt: Date | null;
};

/** A goal is active until it is completed, ended early, or its last day has passed. */
export function isGroupGoalActive(goal: Pick<GroupGoalRecord, 'completedAt' | 'deletedAt' | 'endDate'>, today: DayKey): boolean {
  return !goal.deletedAt && !goal.completedAt && dbDateToDayKey(goal.endDate) >= today;
}

export async function loadGroupGoalProgress(goal: GroupGoalRecord): Promise<GroupGoalProgress> {
  const { prisma } = await import('./prisma');
  const memberships = await prisma.groupMembership.findMany({
    where: { groupId: goal.groupId, status: 'active' },
    select: { userId: true, status: true, includeInStats: true, user: { select: { username: true } } },
  });
  const members: GroupGoalMember[] = memberships.map((m) => ({
    userId: m.userId,
    username: m.user.username,
    includeInStats: m.includeInStats,
    status: m.status,
  }));
  const counted = members.filter((m) => m.includeInStats).map((m) => m.userId);
  const workouts = counted.length
    ? await prisma.workout.findMany({
        where: {
          userId: { in: counted },
          date: { gte: goal.startDate, lte: goal.endDate },
          ...(goal.exerciseType ? { exerciseType: goal.exerciseType } : {}),
        },
        select: { userId: true, date: true, exerciseType: true, reps: true, loadKg: true },
      })
    : [];
  return computeGroupGoalProgress(goal, workouts, members);
}

export type GroupGoalDto = {
  id: string;
  title: string;
  targetPoints: number;
  exerciseType: string | null;
  startDay: DayKey;
  endDay: DayKey;
  createdAt: string;
  completedAt: string | null;
  stopped: boolean;
  totalPoints: number;
  percent: number;
  reached: boolean;
  contributions: GroupGoalContribution[];
};

export function toGroupGoalDto(goal: GroupGoalRecord, progress: GroupGoalProgress): GroupGoalDto {
  return {
    id: goal.id,
    title: goal.title,
    targetPoints: goal.targetPoints,
    exerciseType: goal.exerciseType,
    startDay: dbDateToDayKey(goal.startDate),
    endDay: dbDateToDayKey(goal.endDate),
    createdAt: goal.createdAt.toISOString(),
    completedAt: goal.completedAt ? goal.completedAt.toISOString() : null,
    stopped: Boolean(goal.deletedAt),
    ...progress,
  };
}
