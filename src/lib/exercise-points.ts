import { EXERCISES, pointsPerUnit, toExerciseType, type ExerciseType } from '@/lib/exercises';

export type ExercisePointType = ExerciseType;

// Коэффициенты при эталонном весе; единая шкала и её обоснование — в src/lib/exercises.ts.
export const EXERCISE_POINT_FACTORS = Object.fromEntries(
  Object.values(EXERCISES).map((exercise) => [exercise.id, exercise.pointsPerUnit]),
) as Record<ExercisePointType, number>;

export function toExercisePointType(value?: string | null): ExercisePointType {
  return toExerciseType(value);
}

export function calculateExercisePoints(
  value: number,
  exerciseType?: string | null,
  loadKg?: number | null,
): number {
  const safeValue = Number(value);
  if (!Number.isFinite(safeValue) || safeValue <= 0) return 0;
  return tenthsToPoints(pointsToTenths(safeValue * pointsPerUnit(exerciseType, loadKg)));
}

export function pointsToTenths(points: number): number {
  return Math.round(Number(points) * 10);
}

export function tenthsToPoints(tenths: number): number {
  return tenths / 10;
}
