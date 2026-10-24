/**
 * Круговые тренировки — чистый модуль без БД (импортируется и клиентом, и сервером).
 *
 * Круг — последовательность станций (упражнение + цель), которую проходят `rounds` раз с отдыхом
 * между станциями и между кругами. Здесь: правила сочетаемости станций (spec «Правила
 * сочетаемости»), 10 проверенных шаблонов, 5 программ-ротаций с днями A/B/C, прогрессия по неделям,
 * цели от тест-круга и разбор своего круга пользователя (`CustomCircuit`).
 *
 * Номера: `stationIndex` в предупреждениях — индекс в массиве станций (с 0); `round` и `station`
 * подходов и ключей тренировок — с 1, как `setNumber`.
 */
import { EXERCISES, isExerciseType, type ExerciseType } from './exercises';
import { MAX_DISTANCE_METERS, normalizeLoadKg } from './workout-input';

/** Станция круга. `target` — в единицах упражнения (повторы/секунды/метры), у «на сторону» — на одну сторону. */
export type CircuitStation = { exerciseType: ExerciseType; target: number; loadKg?: number | null };
export type CircuitSpec = { stations: CircuitStation[]; rounds: number; restStationSec: number; restRoundSec: number };
export type CircuitEquipment = 'none' | 'bar' | 'dip_bars' | 'kettlebell' | 'rope' | 'outdoor';
export type CircuitLevel = 'beginner' | 'intermediate' | 'advanced';
export type CircuitTemplate = CircuitSpec & {
  id: string;
  title: { ru: string; en: string };
  equipment: CircuitEquipment[];
  level: CircuitLevel;
};
export type CircuitWarningCode =
  | 'same_group'
  | 'grip_in_row'
  | 'press_in_row'
  | 'swing_late'
  | 'jumps_in_row'
  | 'jump_after_legs'
  | 'static_in_row';
export type CircuitWarning = { rule: 1 | 2 | 3 | 5 | 6 | 7; stationIndex: number; code: CircuitWarningCode };
export type CircuitDayLabel = 'A' | 'B' | 'C';
export type CircuitPlan = {
  id: string;
  title: { ru: string; en: string };
  days: { label: CircuitDayLabel; templateId: string }[];
};

/** Технические упражнения (правило 4): не входят ни в шаблоны, ни в программы, ни в конструктор. */
export const CIRCUIT_EXCLUDED: ExerciseType[] = ['muscle_ups', 'kettlebell_jerk'];

export const CIRCUIT_MAX_STATIONS = 10;
export const CIRCUIT_MAX_CUSTOM = 20;
/** Потолок кругов при прогрессии программы. */
export const CIRCUIT_MAX_ROUNDS = 5;
/** Рост целей программы за неделю. */
export const CIRCUIT_WEEKLY_GROWTH = 1.1;
/** Старт программы — доля результата тест-круга. */
export const CIRCUIT_START_RATIO = 0.7;
/** Свой круг: допустимые круги, отдых, длина названия. */
export const CIRCUIT_ROUNDS_RANGE = { min: 1, max: 10 } as const;
export const CIRCUIT_REST_STATION_RANGE = { min: 0, max: 300 } as const;
export const CIRCUIT_REST_ROUND_RANGE = { min: 0, max: 600 } as const;
export const CIRCUIT_TITLE_MAX = 60;

/** Упражнения, доступные в кругах (порядок каталога). */
export function isCircuitExercise(value: unknown): value is ExerciseType {
  return isExerciseType(value) && !CIRCUIT_EXCLUDED.includes(value) && !EXERCISES[value].tags.includes('technical');
}

// ---------------------------------------------------------------------------
// Шаблоны (spec «Шаблоны (10)»): цели — для начинающего; «на сторону» — на одну сторону.
// ---------------------------------------------------------------------------

function st(exerciseType: ExerciseType, target: number, loadKg?: number): CircuitStation {
  return loadKg != null ? { exerciseType, target, loadKg } : { exerciseType, target };
}

export const CIRCUIT_TEMPLATES: CircuitTemplate[] = [
  {
    id: 'home_full_body',
    title: { ru: 'Дом: всё тело', en: 'Home: full body' },
    equipment: ['none'],
    level: 'beginner',
    stations: [st('squats', 15), st('pushups', 10), st('glute_bridge', 15), st('australian_pullups', 8), st('superman', 12), st('side_plank', 20)],
    rounds: 3,
    restStationSec: 20,
    restRoundSec: 90,
  },
  {
    id: 'home_cardio',
    title: { ru: 'Дом: кардио', en: 'Home: cardio' },
    equipment: ['none'],
    level: 'intermediate',
    stations: [st('burpees', 8), st('squats', 15), st('crunches', 15), st('lunges', 10), st('mountain_climbers', 20), st('plank', 30)],
    rounds: 3,
    restStationSec: 15,
    restRoundSec: 90,
  },
  {
    id: 'home_no_jumps',
    title: { ru: 'Дом: без прыжков', en: 'Home: no jumps' },
    equipment: ['none'],
    level: 'beginner',
    stations: [st('squats', 15), st('pushups', 10), st('mountain_climbers', 20), st('glute_bridge', 15), st('crunches', 15), st('superman', 12), st('plank', 30)],
    rounds: 3,
    restStationSec: 20,
    restRoundSec: 90,
  },
  {
    id: 'home_core_legs',
    title: { ru: 'Дом: корпус и ноги', en: 'Home: core and legs' },
    equipment: ['none'],
    level: 'beginner',
    stations: [st('lunges', 10), st('crunches', 15), st('glute_bridge', 15), st('side_plank', 20), st('squats', 15), st('superman', 12), st('wall_sit', 30)],
    rounds: 3,
    restStationSec: 20,
    restRoundSec: 90,
  },
  {
    id: 'jump_rope',
    title: { ru: 'Скакалка', en: 'Jump rope' },
    equipment: ['rope'],
    level: 'intermediate',
    stations: [st('jump_rope', 50), st('squats', 15), st('pushups', 10), st('jump_rope', 50), st('crunches', 15)],
    rounds: 3,
    restStationSec: 20,
    restRoundSec: 90,
  },
  {
    id: 'bar_and_dips',
    title: { ru: 'Турник и брусья', en: 'Bar and dips' },
    equipment: ['bar', 'dip_bars'],
    level: 'intermediate',
    stations: [st('pullups', 5), st('squats', 15), st('dips', 8), st('lunges', 10), st('crunches', 15)],
    rounds: 3,
    restStationSec: 30,
    restRoundSec: 120,
  },
  {
    id: 'core',
    title: { ru: 'Пресс и корпус', en: 'Abs and core' },
    equipment: ['bar'],
    level: 'intermediate',
    stations: [st('crunches', 15), st('side_plank', 20), st('superman', 12), st('hanging_leg_raises', 8), st('glute_bridge', 15), st('plank', 30)],
    rounds: 3,
    restStationSec: 20,
    restRoundSec: 90,
  },
  {
    id: 'kettlebell',
    title: { ru: 'Гири', en: 'Kettlebell' },
    equipment: ['kettlebell'],
    level: 'intermediate',
    stations: [st('kettlebell_swing', 15, 16), st('pushups', 10), st('squats', 15), st('kettlebell_press', 8, 12), st('plank', 30)],
    rounds: 3,
    restStationSec: 30,
    restRoundSec: 120,
  },
  {
    id: 'kettlebell_full_body',
    title: { ru: 'Гири: всё тело', en: 'Kettlebell: full body' },
    equipment: ['kettlebell'],
    level: 'intermediate',
    stations: [
      st('kettlebell_swing', 15, 16),
      st('kettlebell_press', 6, 12),
      st('squats', 15),
      st('kettlebell_row', 8, 16),
      st('lunges', 8),
      st('superman', 12),
    ],
    rounds: 3,
    restStationSec: 30,
    restRoundSec: 120,
  },
  {
    id: 'run_and_strength',
    title: { ru: 'Бег + сила', en: 'Run + strength' },
    equipment: ['outdoor'],
    level: 'intermediate',
    stations: [st('run', 400), st('pushups', 10), st('run', 400), st('squats', 15), st('crunches', 15)],
    rounds: 3,
    restStationSec: 30,
    restRoundSec: 120,
  },
];

/** Программы-ротации (spec «Программы-ротации»): дни идут по кругу A→B(→C)→A… */
export const CIRCUIT_PLANS: CircuitPlan[] = [
  {
    id: 'home_three',
    title: { ru: 'Дом, 3 раза в неделю', en: 'Home, 3 times a week' },
    days: [
      { label: 'A', templateId: 'home_full_body' },
      { label: 'B', templateId: 'home_cardio' },
      { label: 'C', templateId: 'home_core_legs' },
    ],
  },
  {
    id: 'home_no_jumps',
    title: { ru: 'Дом без прыжков', en: 'Home, no jumps' },
    days: [
      { label: 'A', templateId: 'home_no_jumps' },
      { label: 'B', templateId: 'home_full_body' },
    ],
  },
  {
    id: 'playground',
    title: { ru: 'Площадка', en: 'Outdoor bars' },
    days: [
      { label: 'A', templateId: 'bar_and_dips' },
      { label: 'B', templateId: 'core' },
    ],
  },
  {
    id: 'kettlebells',
    title: { ru: 'Гири', en: 'Kettlebells' },
    days: [
      { label: 'A', templateId: 'kettlebell' },
      { label: 'B', templateId: 'kettlebell_full_body' },
    ],
  },
  {
    id: 'run_strength',
    title: { ru: 'Бег + сила', en: 'Run + strength' },
    days: [
      { label: 'A', templateId: 'run_and_strength' },
      { label: 'B', templateId: 'home_full_body' },
    ],
  },
];

export function getCircuitTemplate(id: string | null | undefined): CircuitTemplate | null {
  return CIRCUIT_TEMPLATES.find((t) => t.id === id) ?? null;
}

export function getCircuitPlan(id: string | null | undefined): CircuitPlan | null {
  return CIRCUIT_PLANS.find((p) => p.id === id) ?? null;
}

// ---------------------------------------------------------------------------
// Правила сочетаемости (G02): предупреждают, но не запрещают
// ---------------------------------------------------------------------------

// Правило 6: прыжок сразу после изометрии/выпадов на ноги — колени и голеностоп «забиты».
const LEG_LOADERS_BEFORE_JUMP: ReadonlySet<ExerciseType> = new Set<ExerciseType>(['wall_sit', 'lunges']);
// Правило 5: мах гирей — на свежую поясницу, не дальше второй станции.
const SWING_LAST_INDEX = 1;

function hasTag(type: ExerciseType, tag: 'grip' | 'jump' | 'static' | 'press'): boolean {
  return EXERCISES[type]?.tags.includes(tag) ?? false;
}

/**
 * Предупреждения о сочетании станций (правила 1–3, 5–7; правило 4 — исключённые упражнения —
 * проверяет разбор своего круга, правило 8 — разминка — не станция). Соседство — только внутри
 * списка: последняя и первая станции соседями не считаются (между кругами отдых).
 */
export function validateCircuit(spec: Pick<CircuitSpec, 'stations'>): CircuitWarning[] {
  const out: CircuitWarning[] = [];
  const types = spec.stations.map((s) => s.exerciseType).filter(isExerciseType);
  if (types.length !== spec.stations.length) return out;

  types.forEach((type, i) => {
    const prev = i > 0 ? types[i - 1] : null;
    if (prev) {
      if (EXERCISES[prev].primaryGroup === EXERCISES[type].primaryGroup) out.push({ rule: 1, stationIndex: i, code: 'same_group' });
      if (hasTag(prev, 'grip') && hasTag(type, 'grip')) out.push({ rule: 2, stationIndex: i, code: 'grip_in_row' });
      if (hasTag(prev, 'press') && hasTag(type, 'press')) out.push({ rule: 3, stationIndex: i, code: 'press_in_row' });
    }
    if (type === 'kettlebell_swing' && i > SWING_LAST_INDEX) out.push({ rule: 5, stationIndex: i, code: 'swing_late' });
    if (hasTag(type, 'jump')) {
      if (i >= 2 && hasTag(types[i - 1], 'jump') && hasTag(types[i - 2], 'jump')) {
        out.push({ rule: 6, stationIndex: i, code: 'jumps_in_row' });
      }
      if (prev && LEG_LOADERS_BEFORE_JUMP.has(prev)) out.push({ rule: 6, stationIndex: i, code: 'jump_after_legs' });
    }
    if (prev && hasTag(prev, 'static') && hasTag(type, 'static')) out.push({ rule: 7, stationIndex: i, code: 'static_in_row' });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Прогрессия программы (R09.5)
// ---------------------------------------------------------------------------

/** Потолок цели станции: повторы 50 (прыжки скакалки 150), секунды 120, метры 800. */
export function circuitTargetCeiling(type: ExerciseType): number {
  const unit = EXERCISES[type]?.unit;
  if (unit === 'distance') return 800;
  if (unit === 'seconds') return 120;
  if (type === 'jump_rope') return 150;
  return 50;
}

/** Цель в единицах упражнения: метры — до 10 м, остальное — целые, не меньше 1 (10 м). */
export function roundCircuitTarget(type: ExerciseType, value: number): number {
  if (EXERCISES[type]?.unit === 'distance') return Math.max(10, Math.round(value / 10) * 10);
  return Math.max(1, Math.round(value));
}

/**
 * Круг на неделю программы `week` (1 — сама база). Объём (круги × цели) растёт на ~10% в неделю.
 * Пока ни одна станция не упирается в потолок — растут цели; упёрлась — добавляется круг (цели
 * пересчитываются под тот же объём), не больше 5 кругов; дальше станции стоят на потолке.
 * Цель, которая уже выше потолка, не снижается.
 */
export function progressCircuit(base: CircuitSpec, week: number): CircuitSpec {
  const w = Math.max(1, Math.floor(Number(week) || 1));
  if (w === 1) return { ...base, stations: base.stations.map((s) => ({ ...s })) };

  const volume = CIRCUIT_WEEKLY_GROWTH ** (w - 1);
  const baseRounds = Math.max(1, base.rounds);
  const maxRounds = Math.max(CIRCUIT_MAX_ROUNDS, baseRounds);
  const caps = base.stations.map((s) => Math.max(circuitTargetCeiling(s.exerciseType), s.target));

  let rounds = baseRounds;
  let factor = volume;
  for (let r = baseRounds; r <= maxRounds; r += 1) {
    rounds = r;
    factor = (volume * baseRounds) / r;
    if (base.stations.every((s, i) => s.target * factor <= caps[i] + 1e-9)) break;
  }

  return {
    ...base,
    rounds,
    stations: base.stations.map((s, i) => ({
      ...s,
      target: Math.min(caps[i], roundCircuitTarget(s.exerciseType, Math.min(caps[i], s.target * factor))),
    })),
  };
}

// ---------------------------------------------------------------------------
// Тест-круг и цели программы (R09.4)
// ---------------------------------------------------------------------------

/** Тест-круг: один круг на максимум, без отдыха между станциями. */
export function circuitTestSpec(template: CircuitSpec): CircuitSpec {
  return { stations: template.stations.map((s) => ({ ...s })), rounds: 1, restStationSec: 0, restRoundSec: 0 };
}

/** Результат станции тест-круга: упражнение, его цель-ориентир и сделанное (null — не сделано). */
export type CircuitTestResult = { exerciseType: string; target: number; actual: number | null };

const TEST_RATIO_RANGE = { min: 0.5, max: 2 } as const;

/**
 * База дня программы после теста: у упражнения из теста — его результат (лучший, если оно было
 * дважды), у остальных — цель шаблона × средняя доля «сделано / ориентир» по тесту (0,5–2).
 * Старт = 70% базы. Без теста база — цели шаблона.
 */
export function circuitStartSpec(template: CircuitSpec, test?: CircuitTestResult[] | null): CircuitSpec {
  const done = (test ?? []).filter((r) => r.actual != null && Number.isFinite(r.actual) && isExerciseType(r.exerciseType));
  const best = new Map<string, number>();
  for (const r of done) best.set(r.exerciseType, Math.max(best.get(r.exerciseType) ?? 0, Number(r.actual)));
  const ratios = done.filter((r) => r.target > 0).map((r) => Number(r.actual) / r.target);
  const ratio = ratios.length
    ? Math.min(TEST_RATIO_RANGE.max, Math.max(TEST_RATIO_RANGE.min, ratios.reduce((a, b) => a + b, 0) / ratios.length))
    : 1;

  return {
    rounds: template.rounds,
    restStationSec: template.restStationSec,
    restRoundSec: template.restRoundSec,
    stations: template.stations.map((s) => {
      const base = best.get(s.exerciseType) ?? s.target * ratio;
      return { ...s, target: roundCircuitTarget(s.exerciseType, base * CIRCUIT_START_RATIO) };
    }),
  };
}

/** Подход программы, который даёт станция круга. */
export type CircuitSetDraft = {
  setNumber: number;
  targetReps: number;
  restSeconds: number;
  isKeySet: boolean;
  exerciseType: ExerciseType;
  loadKg: number | null;
  round: number;
  station: number;
};

/** Подходы занятия: круг за кругом, станция за станцией; отдых после станции, после круга — круговой, в конце — 0. */
export function circuitSessionSets(spec: CircuitSpec): CircuitSetDraft[] {
  const out: CircuitSetDraft[] = [];
  const count = spec.stations.length;
  for (let round = 1; round <= spec.rounds; round += 1) {
    spec.stations.forEach((s, i) => {
      const lastStation = i === count - 1;
      const lastRound = round === spec.rounds;
      out.push({
        setNumber: (round - 1) * count + i + 1,
        targetReps: s.target,
        restSeconds: lastStation ? (lastRound ? 0 : spec.restRoundSec) : spec.restStationSec,
        isKeySet: false,
        exerciseType: s.exerciseType,
        loadKg: s.loadKg ?? null,
        round,
        station: i + 1,
      });
    });
  }
  return out;
}

/** Подходы занятия дня программы на неделю `weekNumber` с целями от теста; null — шаблона нет. */
export function planCircuitSession(
  templateId: string | null | undefined,
  weekNumber: number,
  test?: CircuitTestResult[] | null,
): CircuitSetDraft[] | null {
  const template = getCircuitTemplate(templateId);
  if (!template) return null;
  return circuitSessionSets(progressCircuit(circuitStartSpec(template, test), weekNumber));
}

/** Ключ тренировки станции разового круга (`Workout.clientRequestId`): одна тренировка на станцию круга. */
export function circuitWorkoutKey(runId: string, round: number, station: number): string {
  return `circuit:${runId}:${round}:${station}`;
}

// ---------------------------------------------------------------------------
// Свой круг (R09.2): разбор тела запроса
// ---------------------------------------------------------------------------

export class CircuitError extends Error {
  status: number;
  code: string;
  stationIndex?: number;

  constructor(message: string, code: string, status = 400, stationIndex?: number) {
    super(message);
    this.code = code;
    this.status = status;
    this.stationIndex = stationIndex;
  }
}

export type CustomCircuitInput = { title: string; stations: CircuitStation[]; rounds: number; restStationSec: number; restRoundSec: number };

function intIn(raw: unknown, min: number, max: number): number | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

/** Допустимая цель станции: повторы 1–500, секунды 1–600, метры 10 м – 300 км. */
export function circuitTargetRange(type: ExerciseType): { min: number; max: number } {
  const unit = EXERCISES[type].unit;
  if (unit === 'distance') return { min: 10, max: MAX_DISTANCE_METERS };
  if (unit === 'seconds') return { min: 1, max: 600 };
  return { min: 1, max: 500 };
}

function parseStation(raw: unknown, index: number): CircuitStation {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const type = typeof obj.exerciseType === 'string' ? obj.exerciseType.trim() : '';
  if (!isExerciseType(type)) throw new CircuitError('Неизвестное упражнение', 'CIRCUIT_EXERCISE_INVALID', 400, index);
  if (!isCircuitExercise(type)) {
    throw new CircuitError('Это упражнение недоступно в круговых', 'CIRCUIT_EXERCISE_EXCLUDED', 400, index);
  }
  const range = circuitTargetRange(type);
  const target = intIn(obj.target, range.min, range.max);
  if (target == null) throw new CircuitError(`Цель станции — от ${range.min} до ${range.max}`, 'CIRCUIT_TARGET_INVALID', 400, index);
  if (EXERCISES[type].load) {
    const loadKg = normalizeLoadKg(obj.loadKg);
    if (loadKg == null) throw new CircuitError('Укажите вес гири', 'CIRCUIT_LOAD_REQUIRED', 400, index);
    return { exerciseType: type, target, loadKg };
  }
  return { exerciseType: type, target };
}

/**
 * Свой круг из тела запроса: название, 1–10 станций (исключённые упражнения — 400), круги 1–10,
 * отдых 0–300 с между станциями и 0–600 с между кругами. Ошибка — `CircuitError` с кодом.
 * `fallback` — текущий круг при частичной правке (PATCH): отсутствующие поля берутся из него.
 */
export function parseCustomCircuitInput(body: unknown, fallback?: CustomCircuitInput | null): CustomCircuitInput {
  const obj = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!obj) throw new CircuitError('Некорректный JSON', 'BAD_JSON');

  const titleRaw = obj.title !== undefined ? obj.title : fallback?.title;
  const title = typeof titleRaw === 'string' ? titleRaw.trim().replace(/\s+/g, ' ') : '';
  if (!title || title.length > CIRCUIT_TITLE_MAX) {
    throw new CircuitError(`Название — от 1 до ${CIRCUIT_TITLE_MAX} символов`, 'CIRCUIT_TITLE_INVALID');
  }

  const stationsRaw = obj.stations !== undefined ? obj.stations : fallback?.stations;
  if (!Array.isArray(stationsRaw) || stationsRaw.length === 0) {
    throw new CircuitError('Добавьте хотя бы одну станцию', 'CIRCUIT_STATIONS_INVALID');
  }
  if (stationsRaw.length > CIRCUIT_MAX_STATIONS) {
    throw new CircuitError(`Не больше ${CIRCUIT_MAX_STATIONS} станций`, 'CIRCUIT_TOO_MANY_STATIONS');
  }
  const stations = stationsRaw.map((s, i) => parseStation(s, i));

  const rounds = intIn(obj.rounds !== undefined ? obj.rounds : fallback?.rounds, CIRCUIT_ROUNDS_RANGE.min, CIRCUIT_ROUNDS_RANGE.max);
  if (rounds == null) {
    throw new CircuitError(`Кругов — от ${CIRCUIT_ROUNDS_RANGE.min} до ${CIRCUIT_ROUNDS_RANGE.max}`, 'CIRCUIT_ROUNDS_INVALID');
  }
  const restStationSec = intIn(
    obj.restStationSec !== undefined ? obj.restStationSec : fallback?.restStationSec,
    CIRCUIT_REST_STATION_RANGE.min,
    CIRCUIT_REST_STATION_RANGE.max,
  );
  const restRoundSec = intIn(
    obj.restRoundSec !== undefined ? obj.restRoundSec : fallback?.restRoundSec,
    CIRCUIT_REST_ROUND_RANGE.min,
    CIRCUIT_REST_ROUND_RANGE.max,
  );
  if (restStationSec == null || restRoundSec == null) {
    throw new CircuitError('Отдых: между станциями 0–300 с, между кругами 0–600 с', 'CIRCUIT_REST_INVALID');
  }

  return { title, stations, rounds, restStationSec, restRoundSec };
}

/** Станции, сохранённые в `CustomCircuit.stations` (JSON), — без падения на испорченных строках. */
export function storedCircuitStations(value: unknown): CircuitStation[] {
  if (!Array.isArray(value)) return [];
  const out: CircuitStation[] = [];
  for (const raw of value) {
    const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    const type = obj.exerciseType;
    const target = Number(obj.target);
    if (!isExerciseType(type) || !Number.isFinite(target)) continue;
    const loadKg = obj.loadKg == null ? null : normalizeLoadKg(obj.loadKg);
    out.push(loadKg != null ? { exerciseType: type, target, loadKg } : { exerciseType: type, target });
  }
  return out;
}

export type CustomCircuitRow = {
  id: string;
  title: string;
  stations: unknown;
  rounds: number;
  restStationSec: number;
  restRoundSec: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Свой круг в ответе API — со станциями и предупреждениями о сочетании (G02: сохранить можно). */
export function customCircuitView(row: CustomCircuitRow) {
  const stations = storedCircuitStations(row.stations);
  return {
    id: row.id,
    title: row.title,
    stations,
    rounds: row.rounds,
    restStationSec: row.restStationSec,
    restRoundSec: row.restRoundSec,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    warnings: validateCircuit({ stations }),
  };
}
