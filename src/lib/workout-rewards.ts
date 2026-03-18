import { calculateExercisePoints, pointsToTenths, tenthsToPoints } from '@/lib/exercise-points';

type WorkoutRewardRecord = {
  id: string;
  message: string;
  minPointsTenths: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkoutRewardDto = {
  id: string;
  message: string;
  minPoints: number;
  createdAt: Date;
  updatedAt: Date;
};

export type MatchedWorkoutRewardDto = WorkoutRewardDto & {
  earnedPoints: number;
};

export function serializeWorkoutReward(reward: WorkoutRewardRecord): WorkoutRewardDto {
  return {
    id: reward.id,
    message: reward.message,
    minPoints: tenthsToPoints(reward.minPointsTenths),
    createdAt: reward.createdAt,
    updatedAt: reward.updatedAt,
  };
}

export function parseRewardMinPoints(raw: unknown): { minPoints: number; minPointsTenths: number } | null {
  if (typeof raw === 'string' && raw.trim() === '') return null;
  const minPoints = Number(raw);
  if (!Number.isFinite(minPoints) || minPoints < 0) return null;

  const minPointsTenths = pointsToTenths(minPoints);
  if (minPointsTenths < 0) return null;

  return {
    minPoints: tenthsToPoints(minPointsTenths),
    minPointsTenths,
  };
}

export function getWorkoutPoints(reps: number, exerciseType?: string | null): { earnedPoints: number; earnedPointsTenths: number } {
  const earnedPoints = calculateExercisePoints(reps, exerciseType);
  return {
    earnedPoints,
    earnedPointsTenths: pointsToTenths(earnedPoints),
  };
}

export function matchWorkoutReward(
  reward: WorkoutRewardRecord | null | undefined,
  earnedPoints: number,
): MatchedWorkoutRewardDto | null {
  if (!reward) return null;
  return {
    ...serializeWorkoutReward(reward),
    earnedPoints,
  };
}
