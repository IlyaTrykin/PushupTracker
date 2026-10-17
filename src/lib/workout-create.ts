/**
 * Creating a workout — one path for every source (web form, group manager, Telegram bot):
 * validation, idempotency by `clientRequestId` (B04), the daily creation limit (S12),
 * the record itself, notifications to followers and challenge rivals, and `onWorkoutCreated`.
 */

import { dayKeyInZone, dayKeyToDbDate, normalizeTimeZone } from './calendar-day';
import { challengeTotalDays, scoreChallenge, type ChallengeWorkoutRow } from './challenge-scoring';
import { formatWorkoutValue } from './exercise-metrics';
import { exerciseLabel, isDistanceExercise } from './exercises';
import {
  challengeRankMessage,
  friendWorkoutMessage,
  notifyUsers,
  type LocalizedMessage,
  type NotifyLocale,
  type notifyUsers as notifyUsersFn,
} from './notify';
import { onWorkoutCreated, type CreatedWorkout, type WorkoutHookResult } from './workout-hooks';
import {
  WORKOUT_CREATE_LIMIT_PER_DAY,
  parseClientRequestId,
  parseWorkoutDay,
  parseWorkoutDuration,
  parseWorkoutExerciseType,
  parseWorkoutLoadFields,
  parseWorkoutTime,
} from './workout-input';
import { getWorkoutPoints, matchWorkoutReward } from './workout-rewards';

export const WORKOUT_SELECT = {
  id: true,
  reps: true,
  loadKg: true,
  repsLeft: true,
  repsRight: true,
  durationSeconds: true,
  date: true,
  time: true,
  exerciseType: true,
  trainingSessionId: true,
} as const;

export type WorkoutSource = 'web' | 'telegram' | 'program' | 'health';

/** The owner of the new workout. */
export type WorkoutCreateUser = { id: string; username: string; timeZone?: string | null };

/** Raw fields as they come from a request body or a parsed bot message. Without `date` — today of the user. */
export type WorkoutCreateInput = {
  exerciseType?: unknown;
  reps?: unknown;
  repsLeft?: unknown;
  repsRight?: unknown;
  loadKg?: unknown;
  /** Cardio only: seconds. */
  durationSeconds?: unknown;
  date?: unknown;
  time?: unknown;
  clientRequestId?: unknown;
};

export type WorkoutCreateOptions = {
  source: WorkoutSource;
  /** Who presses the button (a group manager may record for a member); the creation limit is theirs. */
  actorId?: string;
  /** A set of a training-program session (the workout is linked to the session). */
  trainingSessionId?: string | null;
  now?: Date;
};

export type WorkoutCreateResult = WorkoutHookResult & {
  workout: CreatedWorkout;
  reward: ReturnType<typeof matchWorkoutReward>;
  /** The same `clientRequestId` was already recorded: nothing new was created or sent. */
  replayed: boolean;
};

export class WorkoutCreateError extends Error {
  constructor(
    message: string,
    public status: 400 | 429,
    public code: string,
    public retryAfterSeconds = 0,
  ) {
    super(message);
    this.name = 'WorkoutCreateError';
  }
}

type RankParticipant = { userId: string; username: string; status: string };

/**
 * Places in a challenge as its table shows them (`scoreChallenge`): only accepted participants
 * who are still active members of the challenge's group (`activeMemberIds`, null for a non-group
 * challenge) take places (B26); equal results are ordered by username.
 */
export function rankChallengeParticipants(input: {
  mode: string;
  exerciseType: string;
  targetReps: number | null;
  totalDays: number;
  participants: RankParticipant[];
  activeMemberIds: string[] | null;
  workouts: ChallengeWorkoutRow[];
}): Map<string, number> {
  const active = input.activeMemberIds ? new Set(input.activeMemberIds) : null;
  const ranked = input.participants
    .filter((p) => p.status === 'accepted' && (!active || active.has(p.userId)))
    .sort((a, b) => a.username.localeCompare(b.username, 'ru', { sensitivity: 'base' }));

  const rows = scoreChallenge({
    mode: input.mode,
    exerciseType: input.exerciseType,
    targetReps: input.targetReps,
    participantIds: ranked.map((p) => p.userId),
    workouts: input.workouts,
    totalDays: input.totalDays,
  });
  return new Map(rows.map((row, index) => [row.userId, index + 1]));
}

async function db() {
  return (await import('./prisma')).prisma;
}

async function getChallengeRankMap(challengeId: string): Promise<Map<string, number>> {
  const prisma = await db();
  const challenge = await prisma.challenge.findUnique({
    where: { id: challengeId },
    select: {
      groupId: true,
      exerciseType: true,
      mode: true,
      targetReps: true,
      startDate: true,
      endDate: true,
      participants: {
        where: { status: 'accepted' },
        select: { userId: true, status: true, user: { select: { username: true } } },
      },
    },
  });
  if (!challenge) return new Map();

  let activeMemberIds: string[] | null = null;
  if (challenge.groupId) {
    const rows = await prisma.groupMembership.findMany({
      where: { groupId: challenge.groupId, status: 'active', group: { deletedAt: null } },
      select: { userId: true },
    });
    activeMemberIds = rows.map((row) => row.userId);
  }

  const participantIds = challenge.participants.map((p) => p.userId);
  if (!participantIds.length) return new Map();

  const workouts = await prisma.workout.findMany({
    where: {
      userId: { in: participantIds },
      exerciseType: challenge.exerciseType,
      date: { gte: challenge.startDate, lte: challenge.endDate },
    },
    select: { userId: true, date: true, reps: true, loadKg: true, repsLeft: true, repsRight: true },
  });

  return rankChallengeParticipants({
    mode: challenge.mode,
    exerciseType: challenge.exerciseType,
    targetReps: challenge.targetReps,
    totalDays: challengeTotalDays(challenge.startDate, challenge.endDate),
    participants: challenge.participants.map((p) => ({ userId: p.userId, username: p.user.username, status: p.status })),
    activeMemberIds,
    workouts,
  });
}

type WorkoutReward = ReturnType<typeof matchWorkoutReward>;

/** The row a new workout is stored as. */
export type WorkoutInsert = {
  userId: string;
  reps: number;
  loadKg: number | null;
  repsLeft: number | null;
  repsRight: number | null;
  durationSeconds: number | null;
  exerciseType: string;
  date: Date;
  time: Date;
  clientRequestId: string | null;
  trainingSessionId: string | null;
};

type ActiveChallenge = { challengeId: string; challenge: { name: string } };

/** Everything `createWorkoutForUser` touches outside itself (the database, the limiter, notifications, hooks). */
export type WorkoutCreateDeps = {
  findWorkoutByRequestId(userId: string, clientRequestId: string): Promise<CreatedWorkout | null>;
  hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfterSeconds: number }>;
  /** Throws Prisma's P2002 when (userId, clientRequestId) is taken. */
  insertWorkout(data: WorkoutInsert): Promise<CreatedWorkout>;
  findActiveChallenges(userId: string, exerciseType: string, date: Date): Promise<ActiveChallenge[]>;
  challengeRanks(challengeId: string): Promise<Map<string, number>>;
  findFollowerIds(userId: string): Promise<string[]>;
  findReward(reps: number, exerciseType: string, loadKg: number | null): Promise<WorkoutReward>;
  notifyUsers: typeof notifyUsersFn;
  onWorkoutCreated: typeof onWorkoutCreated;
};

function ok<T>(parsed: { ok: true; value: T } | { ok: false; error: string }, code: string): T {
  if (!parsed.ok) throw new WorkoutCreateError(parsed.error, 400, code);
  return parsed.value;
}

export type CreateWorkout = (
  user: WorkoutCreateUser,
  input: WorkoutCreateInput,
  options: WorkoutCreateOptions,
) => Promise<WorkoutCreateResult>;

/** `createWorkoutForUser` over the given dependencies (tests pass fakes). */
export function createWorkoutCreator(deps: WorkoutCreateDeps): CreateWorkout {
  async function replay(workout: CreatedWorkout): Promise<WorkoutCreateResult> {
    return {
      workout,
      reward: await deps.findReward(workout.reps, workout.exerciseType, workout.loadKg),
      records: [],
      achievements: [],
      replayed: true,
    };
  }

  async function notifyAboutWorkout(
    owner: WorkoutCreateUser,
    workout: CreatedWorkout & { durationSeconds?: number | null },
    activeChallenges: ActiveChallenge[],
    beforeRanks: Map<string, Map<string, number>>,
  ): Promise<void> {
    const followerIds = (await deps.findFollowerIds(owner.id)).filter((id) => id !== owner.id);
    await deps.notifyUsers(followerIds, 'friend_workout', (locale) => friendWorkoutText(locale, owner.username, workout), {
      tag: `friend-workout-${owner.id}`,
    });

    for (const c of activeChallenges) {
      const before = beforeRanks.get(c.challengeId) ?? new Map<string, number>();
      const after = await deps.challengeRanks(c.challengeId);
      for (const [participantId, next] of after) {
        const prev = before.get(participantId);
        if (!prev || prev === next || participantId === owner.id) continue;
        await deps.notifyUsers(
          [participantId],
          'challenge_rank_change',
          (locale) => challengeRankMessage(locale, { challengeId: c.challengeId, challengeName: c.challenge.name, previousRank: prev, rank: next }),
          { tag: `challenge-rank-${c.challengeId}` },
        );
      }
    }
  }

  return async function create(user, input, options) {
    const now = options.now ?? new Date();
    const timeZone = normalizeTimeZone(user.timeZone);
    const today = dayKeyInZone(now, timeZone);

    const exerciseType = ok(parseWorkoutExerciseType(input.exerciseType), 'WORKOUT_EXERCISE_INVALID');
    const { reps, loadKg, repsLeft, repsRight } = ok(
      parseWorkoutLoadFields(exerciseType, input as Record<string, unknown>),
      'WORKOUT_VALUE_INVALID',
    );
    const durationSeconds = ok(parseWorkoutDuration(exerciseType, input as Record<string, unknown>), 'WORKOUT_DURATION_INVALID');
    const rawDate = input.date === undefined || input.date === null || input.date === '' ? today : input.date;
    const day = ok(parseWorkoutDay(rawDate, today), 'WORKOUT_DATE_INVALID');
    const time = ok(parseWorkoutTime(input.time, day, timeZone, now), 'WORKOUT_TIME_INVALID');
    const clientRequestId = ok(parseClientRequestId(input.clientRequestId), 'WORKOUT_REQUEST_ID_INVALID');

    if (clientRequestId) {
      const existing = await deps.findWorkoutByRequestId(user.id, clientRequestId);
      if (existing) return replay(existing);
    }

    const limit = await deps.hitRateLimit(`workout-create:${options.actorId ?? user.id}`, WORKOUT_CREATE_LIMIT_PER_DAY, 24 * 60 * 60);
    if (!limit.ok) {
      throw new WorkoutCreateError('Слишком много записей за сутки', 429, 'RATE_LIMITED', limit.retryAfterSeconds);
    }

    const date = dayKeyToDbDate(day);
    const activeChallenges = await deps.findActiveChallenges(user.id, exerciseType, date);

    const beforeRanks = new Map<string, Map<string, number>>();
    for (const c of activeChallenges) {
      beforeRanks.set(c.challengeId, await deps.challengeRanks(c.challengeId).catch(() => new Map<string, number>()));
    }

    let workout: CreatedWorkout;
    try {
      workout = await deps.insertWorkout({
        userId: user.id,
        reps,
        loadKg,
        repsLeft,
        repsRight,
        durationSeconds,
        exerciseType,
        date,
        time,
        clientRequestId,
        trainingSessionId: options.trainingSessionId ?? null,
      });
    } catch (e) {
      // Two copies of the same request raced past the lookup: the loser returns the winner's record.
      const code = (e as { code?: unknown } | null)?.code;
      if (code === 'P2002' && clientRequestId) {
        const existing = await deps.findWorkoutByRequestId(user.id, clientRequestId);
        if (existing) return replay(existing);
      }
      throw e;
    }

    const reward = await deps.findReward(reps, exerciseType, loadKg);

    try {
      await notifyAboutWorkout(user, workout, activeChallenges, beforeRanks);
    } catch (e) {
      console.error('WORKOUT NOTIFICATIONS ERROR:', e);
    }

    let hooks: WorkoutHookResult = { records: [], achievements: [] };
    try {
      hooks = await deps.onWorkoutCreated(workout, { id: user.id, username: user.username, timeZone });
    } catch (e) {
      console.error('WORKOUT HOOK ERROR:', e);
    }

    return { workout, reward, records: hooks.records, achievements: hooks.achievements, replayed: false };
  };
}

const prismaDeps: WorkoutCreateDeps = {
  findWorkoutByRequestId: async (userId, clientRequestId) =>
    (await db()).workout.findUnique({
      where: { userId_clientRequestId: { userId, clientRequestId } },
      select: WORKOUT_SELECT,
    }),
  hitRateLimit: async (key, limit, windowSeconds) => (await import('./rate-limit')).hitRateLimit(key, limit, windowSeconds),
  insertWorkout: async (data) => (await db()).workout.create({ data, select: WORKOUT_SELECT }),
  findActiveChallenges: async (userId, exerciseType, date) =>
    (await db()).challengeParticipant.findMany({
      where: {
        userId,
        status: 'accepted',
        challenge: { exerciseType, startDate: { lte: date }, endDate: { gte: date } },
      },
      select: { challengeId: true, challenge: { select: { name: true } } },
    }),
  challengeRanks: getChallengeRankMap,
  findFollowerIds: async (userId) =>
    (await (await db()).friendFollow.findMany({ where: { friendId: userId }, select: { followerId: true } })).map((f) => f.followerId),
  findReward: async (reps, exerciseType, loadKg) => {
    const { earnedPoints, earnedPointsTenths } = getWorkoutPoints(reps, exerciseType, loadKg);
    return matchWorkoutReward(
      await (await db()).workoutReward.findFirst({
        where: { minPointsTenths: { lte: earnedPointsTenths } },
        orderBy: [{ minPointsTenths: 'desc' }, { createdAt: 'asc' }],
        select: { id: true, message: true, minPointsTenths: true, createdAt: true, updatedAt: true },
      }),
      earnedPoints,
    );
  },
  notifyUsers,
  onWorkoutCreated,
};

/**
 * Validates and records a workout of `user`. Throws `WorkoutCreateError` (400 invalid input,
 * 429 over the daily limit). A repeated `clientRequestId` returns the existing workout.
 */
export const createWorkoutForUser: CreateWorkout = createWorkoutCreator(prismaDeps);

type FriendWorkoutFields = { exerciseType: string; reps: number; loadKg: number | null; durationSeconds?: number | null };

/** «bob: Бег — 5,2 км · 26:30 (5:06/км)» in the recipient's language; the builder from notify.ts, cardio shown in km. */
export function friendWorkoutText(locale: NotifyLocale, username: string, workout: FriendWorkoutFields): LocalizedMessage {
  const message = friendWorkoutMessage(locale, { username, exerciseType: workout.exerciseType, value: workout.reps, loadKg: workout.loadKg });
  if (!isDistanceExercise(workout.exerciseType)) return message;
  return { ...message, body: `${username}: ${exerciseLabel(workout.exerciseType, locale)} — ${formatWorkoutValue(workout, locale)}` };
}
