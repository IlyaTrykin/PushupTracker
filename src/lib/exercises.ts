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

// Порядок = порядок показа везде; первые FAVORITE_EXERCISE_LIMIT — избранное по умолчанию.
export const EXERCISE_IDS = [
  'pushups',
  'pullups',
  'crunches',
  'squats',
  'plank',
  'dips',
  'hanging_leg_raises',
  'muscle_ups',
  'lunges',
  'burpees',
  'jump_rope',
  'wall_sit',
  'kettlebell_press',
  'kettlebell_jerk',
  'kettlebell_swing',
] as const;

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
  dips: {
    id: 'dips',
    label: { ru: 'Брусья', en: 'Dips' },
    code: 'БРС',
    unit: 'reps',
    pointsPerUnit: 2, // ≈15 повторов
    programSupported: false,
    colors: { accent: '#0ea5e9', soft: '#e0f2fe', chart: '#0369a1' },
  },
  hanging_leg_raises: {
    id: 'hanging_leg_raises',
    label: { ru: 'Подъём ног в висе', en: 'Hanging leg raises' },
    code: 'ПНВ',
    unit: 'reps',
    pointsPerUnit: 2.5, // ≈12 повторов
    programSupported: false,
    colors: { accent: '#16a34a', soft: '#dcfce7', chart: '#15803d' },
  },
  muscle_ups: {
    id: 'muscle_ups',
    label: { ru: 'Выход силой', en: 'Muscle-ups' },
    code: 'ВСЛ',
    unit: 'reps',
    pointsPerUnit: 7.5, // ≈4 повтора
    programSupported: false,
    colors: { accent: '#be123c', soft: '#ffe4e6', chart: '#9f1239' },
  },
  // Повторы считаются на каждую ногу.
  lunges: {
    id: 'lunges',
    label: { ru: 'Выпады', en: 'Lunges' },
    code: 'ВПД',
    unit: 'reps',
    pointsPerUnit: 1.2, // ≈25 повторов на ногу
    unilateral: true,
    programSupported: false,
    colors: { accent: '#a16207', soft: '#fef9c3', chart: '#854d0e' },
  },
  burpees: {
    id: 'burpees',
    label: { ru: 'Бёрпи', en: 'Burpees' },
    code: 'БРП',
    unit: 'reps',
    pointsPerUnit: 1.5, // ≈20 повторов
    programSupported: false,
    colors: { accent: '#dc2626', soft: '#fee2e2', chart: '#b91c1c' },
  },
  // Прыжки (обороты скакалки) без остановки.
  jump_rope: {
    id: 'jump_rope',
    label: { ru: 'Скакалка', en: 'Jump rope' },
    code: 'СКК',
    unit: 'reps',
    pointsPerUnit: 0.2, // ≈150 прыжков
    programSupported: false,
    colors: { accent: '#db2777', soft: '#fce7f3', chart: '#be185d' },
  },
  wall_sit: {
    id: 'wall_sit',
    label: { ru: 'Стульчик', en: 'Wall sit' },
    code: 'СТЛ',
    unit: 'seconds',
    pointsPerUnit: 0.25, // ≈120 секунд
    programSupported: false,
    colors: { accent: '#4f46e5', soft: '#e0e7ff', chart: '#4338ca' },
  },
  // Строгий жим одной рукой стоя, без помощи ног. Повторы считаются на каждую руку.
  kettlebell_press: {
    id: 'kettlebell_press',
    label: { ru: 'Жим гири', en: 'Kettlebell press' },
    code: 'ЖГР',
    unit: 'reps',
    pointsPerUnit: 3, // ≈10 повторов на руку с гирей 16 кг
    load: { referenceKg: 16, presetsKg: [8, 12, 16, 20, 24, 28, 32] },
    unilateral: true,
    programSupported: false,
    colors: { accent: '#7c3aed', soft: '#ede9fe', chart: '#6d28d9' },
  },
  // Толчок одной рукой: подсед и выталкивание ногами, затем фиксация над головой.
  // Ноги берут часть работы, поэтому повторов до отказа больше, чем в жиме.
  kettlebell_jerk: {
    id: 'kettlebell_jerk',
    label: { ru: 'Толчок гири', en: 'Kettlebell jerk' },
    code: 'ТГР',
    unit: 'reps',
    pointsPerUnit: 2, // ≈15 повторов на руку с гирей 16 кг
    load: { referenceKg: 16, presetsKg: [8, 12, 16, 20, 24, 28, 32] },
    unilateral: true,
    programSupported: false,
    colors: { accent: '#ea580c', soft: '#ffedd5', chart: '#9a3412' },
  },
  // Махи двумя руками. Упражнение на ноги и спину, поэтому эталон тяжелее, чем в жиме.
  kettlebell_swing: {
    id: 'kettlebell_swing',
    label: { ru: 'Махи гирей', en: 'Kettlebell swing' },
    code: 'МХГ',
    unit: 'reps',
    pointsPerUnit: 1, // ≈30 повторов с гирей 24 кг
    load: { referenceKg: 24, presetsKg: [12, 16, 20, 24, 28, 32] },
    programSupported: false,
    colors: { accent: '#0f766e', soft: '#ccfbf1', chart: '#115e59' },
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

// Сколько упражнений закреплено на экране тренировки; остальные — под кнопкой «Ещё».
export const FAVORITE_EXERCISE_LIMIT = 4;

// Чистит сохранённый список: только известные упражнения, без повторов, не больше лимита.
export function normalizeFavoriteExercises(value: unknown): ExerciseType[] {
  if (!Array.isArray(value)) return [];
  const out: ExerciseType[] = [];
  for (const item of value) {
    if (isExerciseType(item) && !out.includes(item)) out.push(item);
    if (out.length >= FAVORITE_EXERCISE_LIMIT) break;
  }
  return out;
}

// Что показывать на главной: выбор пользователя, а если он пуст — начало каталога.
export function resolveFavoriteExercises(value: unknown): ExerciseType[] {
  const saved = normalizeFavoriteExercises(value);
  return saved.length ? saved : EXERCISE_IDS.slice(0, FAVORITE_EXERCISE_LIMIT);
}

export function exerciseLabelMap(locale: 'ru' | 'en'): Record<ExerciseType, string> {
  return createByExercise((type) => EXERCISES[type].label[locale]);
}

export function createByExercise<T>(factory: (type: ExerciseType) => T): Record<ExerciseType, T> {
  return Object.fromEntries(EXERCISE_IDS.map((id) => [id, factory(id)])) as Record<ExerciseType, T>;
}
