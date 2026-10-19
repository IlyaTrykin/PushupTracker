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
//
// MET и темп («паспорт» для калорий): MET — Compendium of Physical Activities 2024
// (Herrmann et al., pacompendium.com, раздел 02 Conditioning exercise), код строки — в
// комментарии к записи. Темп подобран так, чтобы подход в обычном ритме давал правдоподобную
// длительность: 50 отжиманий ≈ 100 с ≈ 14 активных ккал при 80 кг.

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
  'run',
  'bike',
  'row',
  'australian_pullups',
  'glute_bridge',
  'superman',
  'side_plank',
  'mountain_climbers',
  'kettlebell_row',
] as const;

export type ExerciseType = (typeof EXERCISE_IDS)[number];

// distance: значение хранится в метрах (Workout.reps), вводится в километрах.
export type ExerciseUnit = 'reps' | 'seconds' | 'distance';

// Основная группа — что упражнение нагружает в первую очередь (правило 1 круговых:
// соседние станции не должны грузить одну группу).
export type ExercisePrimaryGroup =
  | 'push'
  | 'pull'
  | 'legs'
  | 'hinge'
  | 'core_flexion'
  | 'core_extension'
  | 'core_lateral'
  | 'cardio';

// grip — нагружает хват; jump — прыжковое; static — удержание; technical — техничное
// (не входит в круговые); press — жим на плечи/трицепс (правило 3 круговых).
export type ExerciseTag = 'grip' | 'jump' | 'static' | 'technical' | 'press';

// Вид программы тренировок по упражнению; null — программы по упражнению нет.
export type ProgramKind = 'reps' | 'timed' | 'loaded' | 'distance';

export type ExerciseDefinition = {
  id: ExerciseType;
  label: { ru: string; en: string };
  // Трёхбуквенный код для плотных сеток (календарь программы).
  code: string;
  unit: ExerciseUnit;
  // Баллы за повтор (секунду, метр) при эталонном весе; комментарий — типичный максимум.
  pointsPerUnit: number;
  // Упражнение со снарядом: вес обязателен, баллы зависят от веса.
  load?: { referenceKg: number; presetsKg: number[] };
  // Выполняется поочерёдно каждой рукой: повторы вводятся отдельно для левой и правой.
  unilateral?: boolean;
  // Можно ли строить по упражнению программу тренировок.
  programSupported: boolean;
  primaryGroup: ExercisePrimaryGroup;
  tags: ExerciseTag[];
  // Базовый MET по Compendium of Physical Activities (2024, код в комментарии записи) — для
  // расчёта активных калорий. У дистанции не используется: там MET считается по скорости.
  met: number;
  // Темп: секунд на повтор (для повторов — каждой стороны/шага); нет у упражнений на время и дистанцию.
  secondsPerRep?: number;
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
    primaryGroup: 'push',
    tags: ['press'],
    met: 7.5, // 02020 calisthenics (pushups…), vigorous
    secondsPerRep: 2,
    colors: { accent: '#38bdf8', soft: '#dbeafe', chart: '#0f766e' },
  },
  pullups: {
    id: 'pullups',
    label: { ru: 'Подтягивания', en: 'Pull-ups' },
    code: 'ПТГ',
    unit: 'reps',
    pointsPerUnit: 3, // ≈10 повторов
    programSupported: true,
    primaryGroup: 'pull',
    tags: ['grip'],
    met: 7.5, // 02020 calisthenics (pull-ups…), vigorous
    secondsPerRep: 3,
    colors: { accent: '#ef4444', soft: '#fee2e2', chart: '#d9485f' },
  },
  crunches: {
    id: 'crunches',
    label: { ru: 'Скручивания', en: 'Crunches' },
    code: 'СКР',
    unit: 'reps',
    pointsPerUnit: 0.5, // ≈60 повторов
    programSupported: true,
    primaryGroup: 'core_flexion',
    tags: [],
    met: 2.8, // 02024 calisthenics (abdominal crunches), light
    secondsPerRep: 2,
    colors: { accent: '#22c55e', soft: '#dcfce7', chart: '#2563eb' },
  },
  squats: {
    id: 'squats',
    label: { ru: 'Приседания', en: 'Squats' },
    code: 'ПРС',
    unit: 'reps',
    pointsPerUnit: 0.7, // ≈43 повтора
    programSupported: true,
    primaryGroup: 'legs',
    tags: [],
    met: 6.5, // 02057 body weight resistance (squat, lunge…), high intensity
    secondsPerRep: 2,
    colors: { accent: '#b8860b', soft: '#fef3c7', chart: '#c27c1a' },
  },
  plank: {
    id: 'plank',
    label: { ru: 'Планка', en: 'Plank' },
    code: 'ПЛН',
    unit: 'seconds',
    pointsPerUnit: 0.1, // ≈300 секунд
    programSupported: true,
    primaryGroup: 'core_flexion',
    tags: ['static'],
    met: 2.8, // 02024 calisthenics (plank), light
    colors: { accent: '#14b8a6', soft: '#ccfbf1', chart: '#7c3aed' },
  },
  dips: {
    id: 'dips',
    label: { ru: 'Брусья', en: 'Dips' },
    code: 'БРС',
    unit: 'reps',
    pointsPerUnit: 2, // ≈15 повторов
    programSupported: false,
    primaryGroup: 'push',
    tags: ['press'],
    met: 7.5, // 02020 calisthenics, vigorous
    secondsPerRep: 2.5,
    colors: { accent: '#0ea5e9', soft: '#e0f2fe', chart: '#0369a1' },
  },
  hanging_leg_raises: {
    id: 'hanging_leg_raises',
    label: { ru: 'Подъём ног в висе', en: 'Hanging leg raises' },
    code: 'ПНВ',
    unit: 'reps',
    pointsPerUnit: 2.5, // ≈12 повторов
    programSupported: false,
    primaryGroup: 'core_flexion',
    tags: ['grip'],
    met: 3.8, // 02022 calisthenics, moderate
    secondsPerRep: 3,
    colors: { accent: '#16a34a', soft: '#dcfce7', chart: '#15803d' },
  },
  muscle_ups: {
    id: 'muscle_ups',
    label: { ru: 'Выход силой', en: 'Muscle-ups' },
    code: 'ВСЛ',
    unit: 'reps',
    pointsPerUnit: 7.5, // ≈4 повтора
    programSupported: false,
    primaryGroup: 'pull',
    tags: ['technical'],
    met: 7.5, // 02020 calisthenics (pull-ups…), vigorous
    secondsPerRep: 5,
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
    primaryGroup: 'legs',
    tags: [],
    met: 6.5, // 02057 body weight resistance (lunge…), high intensity
    secondsPerRep: 2.5,
    colors: { accent: '#a16207', soft: '#fef9c3', chart: '#854d0e' },
  },
  burpees: {
    id: 'burpees',
    label: { ru: 'Бёрпи', en: 'Burpees' },
    code: 'БРП',
    unit: 'reps',
    pointsPerUnit: 1.5, // ≈20 повторов
    programSupported: false,
    primaryGroup: 'cardio',
    tags: ['jump', 'press'],
    met: 7.5, // 02020 calisthenics (burpees…), vigorous
    secondsPerRep: 4,
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
    primaryGroup: 'cardio',
    tags: ['jump'],
    met: 11, // 02068 rope skipping exercise, general
    secondsPerRep: 0.5,
    colors: { accent: '#db2777', soft: '#fce7f3', chart: '#be185d' },
  },
  wall_sit: {
    id: 'wall_sit',
    label: { ru: 'Стульчик', en: 'Wall sit' },
    code: 'СТЛ',
    unit: 'seconds',
    pointsPerUnit: 0.25, // ≈120 секунд
    programSupported: false,
    primaryGroup: 'legs',
    tags: ['static'],
    met: 3.8, // 02022 calisthenics, moderate (отдельной строки для стульчика нет)
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
    primaryGroup: 'push',
    tags: ['press'],
    met: 6, // 02050 resistance training (free weight), vigorous
    secondsPerRep: 3,
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
    primaryGroup: 'push',
    tags: ['technical'],
    met: 6, // 02050 resistance training (free weight), vigorous
    secondsPerRep: 3,
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
    primaryGroup: 'hinge',
    tags: ['grip'],
    met: 9.8, // 02058 kettlebell swings
    secondsPerRep: 2,
    colors: { accent: '#0f766e', soft: '#ccfbf1', chart: '#115e59' },
  },
  // Кардио: значение — метры. Бег и гребля 15 баллов за км, велосипед 5 (в 3 раза легче).
  run: {
    id: 'run',
    label: { ru: 'Бег', en: 'Running' },
    code: 'БЕГ',
    unit: 'distance',
    pointsPerUnit: 0.015,
    programSupported: false,
    primaryGroup: 'cardio',
    tags: [],
    met: 8, // справочно (Compendium 2011, 12150 running, general); считается по скорости
    colors: { accent: '#f97316', soft: '#ffedd5', chart: '#c2410c' },
  },
  bike: {
    id: 'bike',
    label: { ru: 'Велосипед', en: 'Cycling' },
    code: 'ВЕЛ',
    unit: 'distance',
    pointsPerUnit: 0.005,
    programSupported: false,
    primaryGroup: 'cardio',
    tags: [],
    met: 7.5, // справочно (Compendium 2011, 01015 bicycling, general); считается по скорости
    colors: { accent: '#65a30d', soft: '#ecfccb', chart: '#4d7c0f' },
  },
  row: {
    id: 'row',
    label: { ru: 'Гребля', en: 'Rowing' },
    code: 'ГРБ',
    unit: 'distance',
    pointsPerUnit: 0.015,
    programSupported: false,
    primaryGroup: 'cardio',
    tags: [],
    met: 7.3, // справочно (02070 rowing, stationary ergometer, general); считается по скорости
    colors: { accent: '#0891b2', soft: '#cffafe', chart: '#0e7490' },
  },
  // Горизонтальные подтягивания к низкой перекладине (тело под углом, ноги на земле).
  australian_pullups: {
    id: 'australian_pullups',
    label: { ru: 'Австралийские подтягивания', en: 'Australian pull-ups' },
    code: 'АПТ',
    unit: 'reps',
    pointsPerUnit: 1.5, // ≈20 повторов
    programSupported: false,
    primaryGroup: 'pull',
    tags: ['grip'],
    met: 3.8, // 02022 calisthenics (pull-ups…), moderate
    secondsPerRep: 2.5,
    colors: { accent: '#c026d3', soft: '#fae8ff', chart: '#a21caf' },
  },
  glute_bridge: {
    id: 'glute_bridge',
    label: { ru: 'Ягодичный мост', en: 'Glute bridge' },
    code: 'ЯМС',
    unit: 'reps',
    pointsPerUnit: 0.5, // ≈60 повторов
    programSupported: false,
    primaryGroup: 'hinge',
    tags: [],
    met: 3.5, // 02030 calisthenics, light or moderate, general (going up & down from floor)
    secondsPerRep: 2,
    colors: { accent: '#d97706', soft: '#fef3c7', chart: '#b45309' },
  },
  // Лёжа на животе: одновременный подъём рук и ног (разгибатели спины).
  superman: {
    id: 'superman',
    label: { ru: 'Супермен', en: 'Superman' },
    code: 'СПМ',
    unit: 'reps',
    pointsPerUnit: 0.75, // ≈40 повторов
    programSupported: false,
    primaryGroup: 'core_extension',
    tags: [],
    met: 3.5, // 02030 calisthenics, light or moderate, general (back exercises)
    secondsPerRep: 3,
    colors: { accent: '#3b82f6', soft: '#dbeafe', chart: '#1e40af' },
  },
  // Секунды на каждую сторону: итог = левая + правая.
  side_plank: {
    id: 'side_plank',
    label: { ru: 'Боковая планка', en: 'Side plank' },
    code: 'БПЛ',
    unit: 'seconds',
    pointsPerUnit: 0.15, // ≈100 секунд на сторону
    unilateral: true,
    programSupported: false,
    primaryGroup: 'core_lateral',
    tags: ['static'],
    met: 2.8, // 02024 calisthenics (plank), light
    colors: { accent: '#475569', soft: '#e2e8f0', chart: '#334155' },
  },
  // Повтор — шаг одной ногой.
  mountain_climbers: {
    id: 'mountain_climbers',
    label: { ru: 'Альпинист', en: 'Mountain climbers' },
    code: 'АЛП',
    unit: 'reps',
    pointsPerUnit: 0.4, // ≈75 шагов
    programSupported: false,
    primaryGroup: 'cardio',
    tags: [],
    met: 7.5, // 02020 calisthenics, vigorous
    secondsPerRep: 0.5,
    colors: { accent: '#e11d48', soft: '#ffe4e6', chart: '#881337' },
  },
  // Тяга гири одной рукой в наклоне с опорой. Повторы считаются на каждую руку.
  kettlebell_row: {
    id: 'kettlebell_row',
    label: { ru: 'Тяга гири в наклоне', en: 'Kettlebell row' },
    code: 'ТЯГ',
    unit: 'reps',
    pointsPerUnit: 2, // ≈15 повторов на руку с гирей 24 кг
    load: { referenceKg: 24, presetsKg: [12, 16, 20, 24, 28, 32] },
    unilateral: true,
    programSupported: false,
    primaryGroup: 'pull',
    tags: ['grip'],
    met: 6, // 02050 resistance training (free weight), vigorous
    secondsPerRep: 2.5,
    colors: { accent: '#9333ea', soft: '#f3e8ff', chart: '#7e22ce' },
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

export function isDistanceExercise(value?: string | null): boolean {
  return isExerciseType(value) && EXERCISES[value].unit === 'distance';
}

// Вид программы: время, вес снаряда, дистанция, иначе повторы; null — не упражнение каталога.
export function programKind(value?: string | null): ProgramKind | null {
  if (!isExerciseType(value)) return null;
  const exercise = EXERCISES[value];
  if (exercise.unit === 'seconds') return 'timed';
  if (exercise.unit === 'distance') return 'distance';
  if (exercise.load) return 'loaded';
  return 'reps';
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
