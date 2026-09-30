import { getExercise } from '@/lib/exercises';

export const MAX_WORKOUT_VALUE = 9999;
export const MAX_LOAD_KG = 200;

export type WorkoutLoadFields = {
  reps: number;
  loadKg: number | null;
  repsLeft: number | null;
  repsRight: number | null;
};

type ParseResult = { ok: true; value: WorkoutLoadFields } | { ok: false; error: string };

function readSide(raw: unknown): number | null | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > MAX_WORKOUT_VALUE) return 'invalid';
  return value;
}

export function normalizeLoadKg(raw: unknown): number | null {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_LOAD_KG) return null;
  return Math.round(value * 10) / 10;
}

// Разбирает объём подхода из тела запроса с учётом свойств упражнения: у упражнений
// на одну руку итог = левая + правая (если раскладка передана), у упражнений со
// снарядом обязателен вес. Поля, не относящиеся к упражнению, обнуляются.
// `fallback` — текущие значения записи при редактировании.
export function parseWorkoutLoadFields(
  exerciseType: string,
  body: Record<string, unknown>,
  fallback?: WorkoutLoadFields,
): ParseResult {
  const exercise = getExercise(exerciseType);

  let reps = body.reps !== undefined ? Number(body.reps) : fallback?.reps ?? NaN;
  let repsLeft: number | null = null;
  let repsRight: number | null = null;

  if (exercise.unilateral) {
    const hasSides = body.repsLeft !== undefined || body.repsRight !== undefined;
    if (hasSides) {
      const left = readSide(body.repsLeft);
      const right = readSide(body.repsRight);
      if (left === 'invalid' || right === 'invalid') return { ok: false, error: 'Повторы для руки должны быть целым числом ≥ 0' };
      repsLeft = left ?? 0;
      repsRight = right ?? 0;
      reps = repsLeft + repsRight;
    } else if (fallback && (body.reps === undefined || reps === fallback.reps)) {
      // Итог не меняли — раскладка по рукам остаётся прежней.
      repsLeft = fallback.repsLeft;
      repsRight = fallback.repsRight;
    }
  }

  if (!Number.isFinite(reps) || reps <= 0 || reps > MAX_WORKOUT_VALUE) {
    return { ok: false, error: 'reps должен быть числом > 0' };
  }

  let loadKg: number | null = null;
  if (exercise.load) {
    loadKg = body.loadKg !== undefined ? normalizeLoadKg(body.loadKg) : fallback?.loadKg ?? null;
    if (loadKg == null) return { ok: false, error: `Укажите вес снаряда (кг, до ${MAX_LOAD_KG})` };
  }

  return { ok: true, value: { reps, loadKg, repsLeft, repsRight } };
}
