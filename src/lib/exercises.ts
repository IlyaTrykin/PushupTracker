// Единый каталог упражнений. Новое упражнение добавляется только здесь (плюс иконка
// в public/icons/exercise-types/feed): страницы, API-валидация, аналитика и баллы
// берут список и свойства упражнений из этого файла.
//
// Шкала нагрузки — «эквивалентные отжимания» (ЭО): 1 балл = 1 отжимание.
// Коэффициент упражнения = ЭТАЛОННЫЙ_ПОДХОД / типичный максимум в одном подходе,
// где эталонный подход до отказа = 30 баллов (типичный максимум отжиманий ≈ 30).
// Поэтому подход «до отказа» на типичном уровне стоит ≈30 баллов в любом упражнении,
// и суммы по разным упражнениям и между людьми сравнимы. Вес тела пользователя в
// баллы не входит — иначе одинаковая работа у разных людей стоила бы по-разному.
//
// Для упражнений со снарядом коэффициент задан при эталонном весе и масштабируется
// как (вес / эталонный вес)^LOAD_EXPONENT: вдвое больший вес ≈ вчетверо меньше
// повторов до отказа, что близко к таблицам повторов от процента 1ПМ в этом диапазоне.

export const REFERENCE_SET_POINTS = 30;
export const LOAD_EXPONENT = 2;

export const EXERCISE_IDS = ['pushups', 'pullups', 'crunches', 'squats', 'plank'] as const;

export type ExerciseType = (typeof EXERCISE_IDS)[number];

export type ExerciseUnit = 'reps' | 'seconds';

export type ExerciseDefinition = {
  id: ExerciseType;
  label: { ru: string; en: string };
  // Трёхбуквенный код для плотных сеток (календарь программы).
  code: string;
  unit: ExerciseUnit;
  // Баллы за повтор (или за секунду) при эталонном весе; комментарий — типичный максимум.
  pointsPerUnit: number;
  // Упражнение со снарядом: вес обязателен, баллы зависят от веса.
  load?: { referenceKg: number; presetsKg: number[] };
  // Выполняется поочерёдно каждой рукой: повторы вводятся отдельно для левой и правой.
  unilateral?: boolean;
  // Можно ли строить по упражнению программу тренировок.
  programSupported: boolean;
  colors: {
    // Цифры, легенды, акценты.
    accent: string;
    // Мягкий фон плашек.
    soft: string;
    // Серии на графиках прогресса.
    chart: string;
  };
};

const ICON_VERSION = '20260315-2';

export const EXERCISES: Record<ExerciseType, ExerciseDefinition> = {
  pushups: {
    id: 'pushups',
    label: { ru: 'Отжимания', en: 'Push-ups' },
    code: 'ОТЖ',
    unit: 'reps',
    pointsPerUnit: 1, // ≈30 повторов
    programSupported: true,
    colors: { accent: '#38bdf8', soft: '#dbeafe', chart: '#0f766e' },
  },
  pullups: {
    id: 'pullups',
    label: { ru: 'Подтягивания', en: 'Pull-ups' },
    code: 'ПТГ',
    unit: 'reps',
    pointsPerUnit: 3, // ≈10 повторов
    programSupported: true,
    colors: { accent: '#ef4444', soft: '#fee2e2', chart: '#d9485f' },
  },
  crunches: {
    id: 'crunches',
    label: { ru: 'Скручивания', en: 'Crunches' },
    code: 'СКР',
    unit: 'reps',
    pointsPerUnit: 0.5, // ≈60 повторов
    programSupported: true,
    colors: { accent: '#22c55e', soft: '#dcfce7', chart: '#2563eb' },
  },
  squats: {
    id: 'squats',
    label: { ru: 'Приседания', en: 'Squats' },
    code: 'ПРС',
    unit: 'reps',
    pointsPerUnit: 0.7, // ≈43 повтора
    programSupported: true,
    colors: { accent: '#b8860b', soft: '#fef3c7', chart: '#c27c1a' },
  },
  plank: {
    id: 'plank',
    label: { ru: 'Планка', en: 'Plank' },
    code: 'ПЛН',
    unit: 'seconds',
    pointsPerUnit: 0.1, // ≈300 секунд
    programSupported: true,
    colors: { accent: '#14b8a6', soft: '#ccfbf1', chart: '#7c3aed' },
  },
};

export const EXERCISE_ORDER: readonly ExerciseType[] = EXERCISE_IDS;

export const PROGRAM_EXERCISE_ORDER: readonly ExerciseType[] = EXERCISE_IDS.filter((id) => EXERCISES[id].programSupported);

export const DEFAULT_EXERCISE: ExerciseType = 'pushups';

export function isExerciseType(value: unknown): value is ExerciseType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EXERCISES, value);
}

export function toExerciseType(value?: string | null): ExerciseType {
  return isExerciseType(value) ? value : DEFAULT_EXERCISE;
}

export function getExercise(value?: string | null): ExerciseDefinition {
  return EXERCISES[toExerciseType(value)];
}

export function exerciseLabel(value?: string | null, locale: string = 'ru'): string {
  if (!isExerciseType(value)) return value || (locale === 'en' ? 'Exercise' : 'Упражнение');
  return locale === 'en' ? EXERCISES[value].label.en : EXERCISES[value].label.ru;
}

export function exerciseIcon(value?: string | null): string {
  return `/icons/exercise-types/feed/${toExerciseType(value)}.svg?v=${ICON_VERSION}`;
}

export function isLoadedExercise(value?: string | null): boolean {
  return isExerciseType(value) && EXERCISES[value].load != null;
}

export function isUnilateralExercise(value?: string | null): boolean {
  return isExerciseType(value) && EXERCISES[value].unilateral === true;
}

export function isTimedExercise(value?: string | null): boolean {
  return isExerciseType(value) && EXERCISES[value].unit === 'seconds';
}

// Баллы за одну единицу (повтор/секунду) с учётом веса снаряда.
export function pointsPerUnit(value?: string | null, loadKg?: number | null): number {
  const exercise = getExercise(value);
  if (!exercise.load) return exercise.pointsPerUnit;
  const kg = Number(loadKg);
  if (!Number.isFinite(kg) || kg <= 0) return 0;
  return exercise.pointsPerUnit * (kg / exercise.load.referenceKg) ** LOAD_EXPONENT;
}

export function exerciseLabelMap(locale: 'ru' | 'en'): Record<ExerciseType, string> {
  return createByExercise((type) => EXERCISES[type].label[locale]);
}

export function createByExercise<T>(factory: (type: ExerciseType) => T): Record<ExerciseType, T> {
  return Object.fromEntries(EXERCISE_IDS.map((id) => [id, factory(id)])) as Record<ExerciseType, T>;
}
