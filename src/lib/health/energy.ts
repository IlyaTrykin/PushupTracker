/**
 * Активные калории тренировки — чистые функции (сервер пишет `Workout.activeKcal`, приложение
 * считает ими же запись в Health до прихода тренировки на сервер).
 *
 * - Время: повторы × темп упражнения (`secondsPerRep` из каталога; у «на сторону» — сумма сторон),
 *   упражнения на время — само значение, дистанция — своё время или типичный темп; минимум 30 с.
 * - MET: из каталога (Compendium 2024); у гирь растёт с весом гири относительно эталона
 *   (×0.7…×1.5); у бега, велосипеда и гребли — по скорости (таблицы Compendium).
 * - Поправка на телосложение: скорректированный MET = MET × 3,5 / RMR, где RMR (мл/кг/мин) — покой
 *   по Харрису—Бенедикту (нужны рост, возраст и пол; без них — стандартные 3,5).
 * - Активные = (MET_corr − 1) × покой человека × вес × часы, т.е. только сверх покоя; без поправки
 *   покой = 1 ккал/кг/ч и формула сводится к (MET − 1) × вес × часы. Без веса — null.
 */
import { getExercise, isExerciseType } from '../exercises';

export type BodyMetrics = { weightKg: number | null; heightCm?: number | null; birthDate?: string | null; sex?: 'male' | 'female' | 'other' | null };
export type EnergySource = { exerciseType: string; reps: number; durationSeconds?: number | null; loadKg?: number | null; repsLeft?: number | null; repsRight?: number | null };

export const MIN_WORKOUT_SECONDS = 30;
/** Стандартный покой: 1 MET = 3,5 мл O₂/кг/мин ≈ 1 ккал/кг/ч. */
const STANDARD_RMR_ML_KG_MIN = 3.5;
/** ккал на литр кислорода. */
const KCAL_PER_LITER_O2 = 5;
const LOAD_FACTOR_MIN = 0.7;
const LOAD_FACTOR_MAX = 1.5;
/** Темп по умолчанию, если у упражнения его нет (не должно случаться в каталоге). */
const DEFAULT_SECONDS_PER_REP = 3;

/** Типичный темп дистанции без своего времени, с/м: бег 10 км/ч, велосипед 25 км/ч, гребля 2:30 на 500 м. */
const TYPICAL_SECONDS_PER_METER: Record<string, number> = { run: 0.36, bike: 0.144, row: 0.3 };

type Curve = ReadonlyArray<readonly [number, number]>;

// Бег/ходьба: скорость км/ч → MET (Compendium 2011, 12xxx running, 17xxx walking).
const RUN_MET_BY_KMH: Curve = [
  [3.2, 2.8], [4.8, 3.5], [5.6, 4.3], [6.4, 6.0], [8.0, 8.3], [8.4, 9.0], [9.7, 9.8], [10.8, 10.5],
  [11.3, 11.0], [12.1, 11.5], [12.9, 11.8], [13.8, 12.3], [14.5, 12.8], [16.1, 14.5], [17.7, 16.0], [19.3, 19.0],
];
// Велосипед: км/ч → MET (Compendium 2011, 01xxx bicycling: <16 км/ч досуг … >32 км/ч гонка).
const BIKE_MET_BY_KMH: Curve = [
  [9, 3.5], [16, 5.8], [17.5, 6.8], [21, 8.0], [24, 10.0], [28, 12.0], [32, 15.8],
];
// Гребной тренажёр: мощность Вт → MET (Compendium 2011, 02071–02074: 50/100/150/200 Вт).
const ROW_MET_BY_WATTS: Curve = [
  [50, 3.5], [100, 7.0], [150, 8.5], [200, 12.0],
];

function interpolate(curve: Curve, x: number): number {
  if (x <= curve[0][0]) return curve[0][1];
  for (let i = 1; i < curve.length; i++) {
    const [x1, y1] = curve[i];
    if (x <= x1) {
      const [x0, y0] = curve[i - 1];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return curve[curve.length - 1][1];
}

function positive(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Повторы/секунды записи: у «на сторону» — сумма сторон, если она известна. */
function totalUnits(w: EnergySource): number {
  const exercise = getExercise(w.exerciseType);
  if (exercise.unilateral && w.repsLeft != null && w.repsRight != null) {
    return Math.max(0, Number(w.repsLeft) || 0) + Math.max(0, Number(w.repsRight) || 0);
  }
  return Math.max(0, Number(w.reps) || 0);
}

function rawDurationSeconds(w: EnergySource): number {
  const own = positive(w.durationSeconds);
  if (own) return own;
  const exercise = getExercise(w.exerciseType);
  const units = totalUnits(w);
  if (exercise.unit === 'seconds') return units;
  if (exercise.unit === 'distance') return units * (TYPICAL_SECONDS_PER_METER[exercise.id] ?? TYPICAL_SECONDS_PER_METER.run);
  return units * (exercise.secondsPerRep ?? DEFAULT_SECONDS_PER_REP);
}

/** Длительность записи, с: темп × повторы, время упражнения, время или типичный темп дистанции; минимум 30 с. */
export function workoutDurationSeconds(w: EnergySource): number {
  return Math.max(MIN_WORKOUT_SECONDS, Math.round(rawDurationSeconds(w)));
}

/** Базовый MET записи: дистанция — по скорости, гиря — с поправкой на вес. */
function workoutMet(w: EnergySource, seconds: number): number {
  const exercise = getExercise(w.exerciseType);
  if (exercise.unit === 'distance') {
    const metersPerSecond = totalUnits(w) / seconds;
    if (exercise.id === 'row') return interpolate(ROW_MET_BY_WATTS, 2.8 * metersPerSecond ** 3); // мощность по формуле Concept2
    return interpolate(exercise.id === 'bike' ? BIKE_MET_BY_KMH : RUN_MET_BY_KMH, metersPerSecond * 3.6);
  }
  const loadKg = positive(w.loadKg);
  if (exercise.load && loadKg) {
    const factor = Math.min(LOAD_FACTOR_MAX, Math.max(LOAD_FACTOR_MIN, loadKg / exercise.load.referenceKg));
    return exercise.met * factor;
  }
  return exercise.met;
}

/** Полных лет на день `day` ('YYYY-MM-DD'); дата рождения — 'YYYY-MM-DD' или ISO. */
export function ageOn(birthDate: string, day: string): number {
  const [by, bm, bd] = birthDate.slice(0, 10).split('-').map(Number);
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  const age = y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
  return Number.isFinite(age) ? age : NaN;
}

/** Покой по Харрису—Бенедикту (пересмотр Roza & Shizgal, 1984), ккал/сут; null — данных не хватает. */
function harrisBenedictKcalPerDay(body: BodyMetrics, weightKg: number, onDate: string): number | null {
  const heightCm = positive(body.heightCm);
  if (!heightCm || !body.birthDate || !body.sex) return null;
  const age = ageOn(body.birthDate, onDate);
  if (!Number.isFinite(age) || age < 5 || age > 110) return null;
  const male = 88.362 + 13.397 * weightKg + 4.799 * heightCm - 5.677 * age;
  const female = 447.593 + 9.247 * weightKg + 3.098 * heightCm - 4.33 * age;
  if (body.sex === 'male') return male;
  if (body.sex === 'female') return female;
  if (body.sex === 'other') return (male + female) / 2;
  return null;
}

/**
 * Покой человека относительно стандартного (3,5 мл/кг/мин): 1 — без поправки.
 * Ограничен 0.5…2, чтобы опечатка в профиле не давала абсурдных калорий.
 */
function restingRatio(body: BodyMetrics, weightKg: number, onDate: string): number {
  const kcalPerDay = harrisBenedictKcalPerDay(body, weightKg, onDate);
  if (!kcalPerDay || kcalPerDay <= 0) return 1;
  const mlPerKgMin = ((kcalPerDay / 1440 / KCAL_PER_LITER_O2) * 1000) / weightKg;
  return Math.min(2, Math.max(0.5, mlPerKgMin / STANDARD_RMR_ML_KG_MIN));
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Активные ккал записи (1 знак); null — нет веса. `onDate` — день тренировки (для возраста). */
export function estimateActiveEnergy(w: EnergySource, body: BodyMetrics, onDate?: string): number | null {
  const weightKg = positive(body.weightKg);
  if (!weightKg) return null;
  if (totalUnits(w) <= 0 || !isExerciseType(w.exerciseType)) return 0;

  const seconds = workoutDurationSeconds(w);
  const met = workoutMet(w, seconds);
  const resting = restingRatio(body, weightKg, onDate ?? todayKey());
  const correctedMet = met / resting; // в «покоях» этого человека
  const kcal = Math.max(0, correctedMet - 1) * resting * weightKg * (seconds / 3600);
  return Math.round(kcal * 10) / 10;
}
