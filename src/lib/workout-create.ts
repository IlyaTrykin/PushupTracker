/**
 * Creating a workout — one path for every source (web form, group manager, Telegram bot):
 * validation, idempotency by `clientRequestId` (B04), the daily creation limit (S12),
 * the record itself, notifications to followers and challenge rivals, and `onWorkoutCreated`.
 */

import { dayKeyInZone, dayKeyToDbDate, normalizeTimeZone } from './calendar-day';
import { challengeTotalDays, scoreChallenge, type ChallengeWorkoutRow } from './challenge-scoring';
import { formatExerciseValue } from './exercise-metrics';
import { onWorkoutCreated, type CreatedWorkout, type WorkoutHookResult } from './workout-hooks';
import {
  WORKOUT_CREATE_LIMIT_PER_DAY,
  parseClientRequestId,
  parseWorkoutDay,
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
  date: true,
  time: true,
  exerciseType: true,
  trainingSessionId: true,
} as const;

export type WorkoutSource = 'web' | 'telegram';

/** The owner of the new workout. */
export type WorkoutCreateUser = { id: string; username: string; timeZone?: string | null };

/** Raw fields as they come from a request body or a parsed bot message. Without `date` — today of the user. */
export type WorkoutCreateInput = {
  exerciseType?: unknown;
  reps?: unknown;
  repsLeft?: unknown;
  repsRight?: unknown;
  loadKg?: unknown;
  date?: unknown;
  time?: unknown;
  clientRequestId?: unknown;
};

export type WorkoutCreateOptions = {
  source: WorkoutSource;
  /** Who presses the button (a group manager may record for a member); the creation limit is theirs. */
  actorId?: string;
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

async function findReward(reps: number, exerciseType: string, loadKg: number | null) {
  const prisma = await db();
  const { earnedPoints, earnedPointsTenths } = getWorkoutPoints(reps, exerciseType, loadKg);
  return matchWorkoutReward(
    await prisma.workoutReward.findFirst({
      where: { minPointsTenths: { lte: earnedPointsTenths } },
      orderBy: [{ minPointsTenths: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, message: true, minPointsTenths: true, createdAt: true, updatedAt: true },
    }),
    earnedPoints,
  );
}

function ok<T>(parsed: { ok: true; value: T } | { ok: false; error: string }, code: string): T {
  if (!parsed.ok) throw new WorkoutCreateError(parsed.error, 400, code);
  return parsed.value;
}

async function replay(workout: CreatedWorkout): Promise<WorkoutCreateResult> {
  return {
    workout,
    reward: await findReward(workout.reps, workout.exerciseType, workout.loadKg),
    records: [],
    achievements: [],
    replayed: true,
  };
}

/**
 * Validates and records a workout of `user`. Throws `WorkoutCreateError` (400 invalid input,
 * 429 over the daily limit). A repeated `clientRequestId` returns the existing workout.
 */
export async function createWorkoutForUser(
  user: WorkoutCreateUser,
  input: WorkoutCreateInput,
  options: WorkoutCreateOptions,
): Promise<WorkoutCreateResult> {
  const prisma = await db();
  const now = options.now ?? new Date();
  const timeZone = normalizeTimeZone(user.timeZone);
  const today = dayKeyInZone(now, timeZone);

  const exerciseType = ok(parseWorkoutExerciseType(input.exerciseType), 'WORKOUT_EXERCISE_INVALID');
  const { reps, loadKg, repsLeft, repsRight } = ok(
    parseWorkoutLoadFields(exerciseType, input as Record<string, unknown>),
    'WORKOUT_VALUE_INVALID',
  );
  const rawDate = input.date === undefined || input.date === null || input.date === '' ? today : input.date;
  const day = ok(parseWorkoutDay(rawDate, today), 'WORKOUT_DATE_INVALID');
  const time = ok(parseWorkoutTime(input.time, day, timeZone, now), 'WORKOUT_TIME_INVALID');
  const clientRequestId = ok(parseClientRequestId(input.clientRequestId), 'WORKOUT_REQUEST_ID_INVALID');

  const findExisting = (requestId: string) =>
    prisma.workout.findUnique({
      where: { userId_clientRequestId: { userId: user.id, clientRequestId: requestId } },
      select: WORKOUT_SELECT,
    });

  if (clientRequestId) {
    const existing = await findExisting(clientRequestId);
    if (existing) return replay(existing);
  }

  const { hitRateLimit } = await import('./rate-limit');
  const limit = await hitRateLimit(`workout-create:${options.actorId ?? user.id}`, WORKOUT_CREATE_LIMIT_PER_DAY, 24 * 60 * 60);
  if (!limit.ok) {
    throw new WorkoutCreateError('Слишком много записей за сутки', 429, 'RATE_LIMITED', limit.retryAfterSeconds);
  }

  const date = dayKeyToDbDate(day);
  const activeChallenges = await prisma.challengeParticipant.findMany({
    where: {
      userId: user.id,
      status: 'accepted',
      challenge: { exerciseType, startDate: { lte: date }, endDate: { gte: date } },
    },
    select: { challengeId: true, challenge: { select: { name: true } } },
  });

  const beforeRanks = new Map<string, Map<string, number>>();
  for (const c of activeChallenges) {
    beforeRanks.set(c.challengeId, await getChallengeRankMap(c.challengeId).catch(() => new Map<string, number>()));
  }

  let workout: CreatedWorkout;
  try {
    workout = await prisma.workout.create({
      data: { userId: user.id, reps, loadKg, repsLeft, repsRight, exerciseType, date, time, clientRequestId },
      select: WORKOUT_SELECT,
    });
  } catch (e) {
    // Two copies of the same request raced past the lookup: the loser returns the winner's record.
    const code = (e as { code?: unknown } | null)?.code;
    if (code === 'P2002' && clientRequestId) {
      const existing = await findExisting(clientRequestId);
      if (existing) return replay(existing);
    }
    throw e;
  }

  const reward = await findReward(reps, exerciseType, loadKg);

  try {
    await notifyAboutWorkout(user, workout, activeChallenges, beforeRanks);
  } catch (e) {
    console.error('WORKOUT NOTIFICATIONS ERROR:', e);
  }

  let hooks: WorkoutHookResult = { records: [], achievements: [] };
  try {
    hooks = await onWorkoutCreated(workout, { id: user.id, username: user.username, timeZone });
  } catch (e) {
    console.error('WORKOUT HOOK ERROR:', e);
  }

  return { workout, reward, records: hooks.records, achievements: hooks.achievements, replayed: false };
}

async function notifyAboutWorkout(
  owner: WorkoutCreateUser,
  workout: CreatedWorkout,
  activeChallenges: Array<{ challengeId: string; challenge: { name: string } }>,
  beforeRanks: Map<string, Map<string, number>>,
): Promise<void> {
  const prisma = await db();
  const { queueWebPushToUsers } = await import('./web-push');
  const { exerciseType, reps, loadKg } = workout;

  const value = loadKg != null
    ? `${formatExerciseValue(reps, exerciseType, true)} × ${loadKg} кг`
    : formatExerciseValue(reps, exerciseType, true);

  const followers = await prisma.friendFollow.findMany({
    where: { friendId: owner.id },
    select: { followerId: true },
  });
  const followerIds = followers.map((f) => f.followerId).filter((id) => id !== owner.id);

  const friendMessage = {
    title: 'Новая тренировка друга',
    body: `${owner.username}: ${value} (${exerciseType})`,
    link: '/friends',
  };
  const notifications: Array<{ userId: string; type: string; title: string; body: string; link: string }> =
    followerIds.map((userId) => ({ userId, type: 'friend_workout', ...friendMessage }));
  const pushes: Array<() => void> = [];
  if (followerIds.length) {
    pushes.push(() => queueWebPushToUsers(followerIds, { ...friendMessage, tag: `friend-workout-${owner.id}` }, 'friend_workout'));
  }

  for (const c of activeChallenges) {
    const before = beforeRanks.get(c.challengeId) ?? new Map<string, number>();
    const after = await getChallengeRankMap(c.challengeId);
    for (const [participantId, next] of after) {
      const prev = before.get(participantId);
      if (!prev || prev === next || participantId === owner.id) continue;
      const message = {
        title: 'Изменилось место в соревновании',
        body: `${c.challenge.name}: ${prev} → ${next} (${next < prev ? 'поднялись' : 'опустились'})`,
        link: `/challenges/${c.challengeId}`,
      };
      notifications.push({ userId: participantId, type: 'challenge_rank_change', ...message });
      pushes.push(() => queueWebPushToUsers([participantId], { ...message, tag: `challenge-rank-${c.challengeId}` }, 'challenge_rank_change'));
    }
  }

  if (notifications.length) await prisma.notification.createMany({ data: notifications });
  pushes.forEach((send) => send());
}
