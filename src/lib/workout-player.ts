/**
 * Пошаговое занятие (проигрыватель) — чистая логика без React и сети.
 *
 * План шагов: разминка (только у круговых, пропускаемая, без тренировок) → упражнение → отдых →
 * упражнение … Один план и для занятия программы (подходы с сервера), и для разового круга
 * (шаблон или свой круг). Здесь же — с какого шага продолжить, тело записи подхода программы,
 * тренировка станции разового круга (ключ `circuit:<runId>:<round>:<station>`) и сохранённое на
 * устройстве состояние разового круга.
 */
import {
  CIRCUIT_REST_ROUND_RANGE,
  CIRCUIT_REST_STATION_RANGE,
  CIRCUIT_ROUNDS_RANGE,
  circuitSessionSets,
  circuitWorkoutKey,
  isCircuitExercise,
  type CircuitSpec,
  type CircuitStation,
} from './circuits';
import { dayKeyInZone } from './calendar-day';
import { isDistanceExercise, isUnilateralExercise } from './exercises';
import type { NewOutboxPayload } from './offline/outbox-core';
import { MAX_DISTANCE_METERS, MAX_DURATION_SECONDS, normalizeLoadKg } from './workout-input';

/** Разминка перед кругом: 4 минуты (spec: 3–5 мин). */
export const WARMUP_SECONDS = 240;

const MAX_SET_VALUE = 5000;
const MIN_DISTANCE_METERS = 10;

export type PlayerStepKind = 'warmup' | 'exercise' | 'rest';

/**
 * Шаг занятия. У упражнения `target` — в единицах упражнения (повторы/секунды/метры), у «на сторону»
 * (`perSide`) — на одну сторону; `round`/`station` — с 1 (у круговых); `setId` — подход программы.
 * У отдыха и разминки `seconds` — длительность таймера.
 */
export type PlayerStep = {
  id: string;
  kind: PlayerStepKind;
  exerciseType?: string;
  target?: number;
  perSide?: boolean;
  loadKg?: number | null;
  seconds?: number;
  round?: number;
  station?: number;
  /** Всего кругов и станций (для подписи «Круг 2/3 · станция 4/6»). */
  rounds?: number;
  stations?: number;
  setId?: string;
  /** Номер подхода и число подходов (обычная программа). */
  setNumber?: number;
  totalSets?: number;
};

/** Что ввёл человек: итог (повторы/секунды/метры), стороны, время дистанции (с). */
export type StepResult = { value?: number; left?: number; right?: number; seconds?: number | null };

type SessionSet = {
  id: string;
  setNumber: number;
  targetReps: number;
  restSeconds: number;
  exerciseType?: string | null;
  loadKg?: number | null;
  round?: number | null;
  station?: number | null;
};

type StepSource = {
  idOf: (set: SessionSet) => string;
  restIdOf: (set: SessionSet) => string;
  setIdOf?: (set: SessionSet) => string;
};

function buildSteps(
  sets: SessionSet[],
  fallback: { exerciseType: string; loadKg?: number | null },
  warmup: boolean,
  source: StepSource,
): PlayerStep[] {
  const ordered = sets.slice().sort((a, b) => a.setNumber - b.setNumber);
  const rounds = Math.max(0, ...ordered.map((s) => s.round ?? 0));
  const stations = Math.max(0, ...ordered.map((s) => s.station ?? 0));
  const out: PlayerStep[] = warmup ? [{ id: 'warmup', kind: 'warmup', seconds: WARMUP_SECONDS }] : [];
  ordered.forEach((set, i) => {
    const exerciseType = set.exerciseType || fallback.exerciseType;
    const loadKg = set.loadKg ?? fallback.loadKg ?? null;
    const step: PlayerStep = {
      id: source.idOf(set),
      kind: 'exercise',
      exerciseType,
      target: set.targetReps,
      perSide: isUnilateralExercise(exerciseType),
      loadKg,
      setNumber: i + 1,
      totalSets: ordered.length,
    };
    if (source.setIdOf) step.setId = source.setIdOf(set);
    if (set.round != null && set.station != null) {
      step.round = set.round;
      step.station = set.station;
      step.rounds = rounds;
      step.stations = stations;
    }
    out.push(step);
    const last = i === ordered.length - 1;
    if (!last && set.restSeconds > 0) out.push({ id: source.restIdOf(set), kind: 'rest', seconds: set.restSeconds });
  });
  return out;
}

/** Круговая ли программа (у неё перед первым кругом разминка). */
function isCircuitProgram(p: { exerciseType: string; programType?: string | null }): boolean {
  return p.programType === 'circuit' || p.exerciseType === 'circuit';
}

/**
 * План занятия программы по его подходам: подход → отдых подхода (если > 0, кроме последнего).
 * Упражнение и вес подхода — свои (станция круга), иначе программы. У круговой — разминка в начале.
 */
export function programSessionSteps(program: {
  exerciseType: string;
  programType?: string | null;
  loadKg?: number | null;
  sets: SessionSet[];
}): PlayerStep[] {
  return buildSteps(program.sets, program, isCircuitProgram(program), {
    idOf: (set) => `set:${set.id}`,
    restIdOf: (set) => `rest:${set.id}`,
    setIdOf: (set) => set.id,
  });
}

/** План разового круга: разминка, затем круг за кругом с отдыхом между станциями и кругами. */
export function circuitRunSteps(spec: CircuitSpec): PlayerStep[] {
  const sets = circuitSessionSets(spec).map((s) => ({
    id: `${s.round}:${s.station}`,
    setNumber: s.setNumber,
    targetReps: s.targetReps,
    restSeconds: s.restSeconds,
    exerciseType: s.exerciseType,
    loadKg: s.loadKg,
    round: s.round,
    station: s.station,
  }));
  return buildSteps(sets, { exerciseType: sets[0]?.exerciseType ?? 'pushups' }, true, {
    idOf: (set) => `st:${set.round}:${set.station}`,
    restIdOf: (set) => `rest:${set.round}:${set.station}`,
  });
}

/**
 * С какого шага продолжить: первое не сделанное упражнение (отдых перед ним пропускается).
 * Пока ничего не сделано — с разминки, а если её уже прошли или пропустили — с первого упражнения.
 * Всё сделано — `steps.length`.
 */
export function resumeStepIndex(steps: PlayerStep[], done: ReadonlySet<string>, opts: { warmupDone?: boolean } = {}): number {
  const anyDone = steps.some((s) => s.kind === 'exercise' && done.has(s.id));
  if (!anyDone) {
    if (!opts.warmupDone) return 0;
    const first = steps.findIndex((s) => s.kind !== 'warmup');
    return first >= 0 ? first : steps.length;
  }
  const next = steps.findIndex((s) => s.kind === 'exercise' && !done.has(s.id));
  return next >= 0 ? next : steps.length;
}

/** Следующее упражнение после шага `index` (показывается заранее — на упражнении и на отдыхе). */
export function upcomingExercise(steps: PlayerStep[], index: number): PlayerStep | null {
  for (let i = index + 1; i < steps.length; i += 1) {
    if (steps[i].kind === 'exercise') return steps[i];
  }
  return null;
}

function intIn(value: unknown, min: number, max: number): number | null {
  const n = Number(value);
  if (value === undefined || value === null || !Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

type CheckedResult =
  | { kind: 'sides'; left: number; right: number }
  | { kind: 'distance'; meters: number; seconds: number | null }
  | { kind: 'value'; value: number };

/** Ввод проверен по виду упражнения шага; `null` — записывать нечего (0, пусто, вне границ). */
function checkResult(step: PlayerStep, result: StepResult): CheckedResult | null {
  if (step.kind !== 'exercise' || !step.exerciseType) return null;
  if (step.perSide) {
    const left = intIn(result.left ?? 0, 0, MAX_SET_VALUE);
    const right = intIn(result.right ?? 0, 0, MAX_SET_VALUE);
    if (left == null || right == null || left + right <= 0) return null;
    return { kind: 'sides', left, right };
  }
  if (isDistanceExercise(step.exerciseType)) {
    const meters = intIn(result.value, MIN_DISTANCE_METERS, MAX_DISTANCE_METERS);
    if (meters == null) return null;
    const seconds = result.seconds == null ? null : intIn(result.seconds, 1, MAX_DURATION_SECONDS);
    return { kind: 'distance', meters, seconds };
  }
  const value = intIn(result.value, 1, MAX_SET_VALUE);
  return value == null ? null : { kind: 'value', value };
}

/** Тело `POST /api/program/session/<id>/set/<setId>`: повторы/секунды, стороны или метры (+ время). */
export function programSetBody(
  step: PlayerStep,
  result: StepResult,
): { actualReps?: number; actualLeft?: number; actualRight?: number; actualSeconds?: number } | null {
  const checked = checkResult(step, result);
  if (!checked) return null;
  if (checked.kind === 'sides') return { actualLeft: checked.left, actualRight: checked.right };
  if (checked.kind === 'distance') {
    return checked.seconds != null ? { actualReps: checked.meters, actualSeconds: checked.seconds } : { actualReps: checked.meters };
  }
  return { actualReps: checked.value };
}

/**
 * Тренировка станции разового круга для очереди отправки: день — календарный день пользователя в
 * момент «Готово», ключ — `circuit:<runId>:<round>:<station>` (повторная отправка не создаёт вторую).
 * «На сторону» — сумма сторон и раскладка, гиря — вес, дистанция — метры и время (если введено).
 */
export function circuitStationPayload(args: {
  runId: string;
  step: PlayerStep;
  result: StepResult;
  now: Date;
  timeZone: string;
}): NewOutboxPayload | null {
  const { step } = args;
  if (step.round == null || step.station == null || !step.exerciseType) return null;
  const checked = checkResult(step, args.result);
  if (!checked) return null;
  const payload: NewOutboxPayload = {
    exerciseType: step.exerciseType,
    reps: checked.kind === 'sides' ? checked.left + checked.right : checked.kind === 'distance' ? checked.meters : checked.value,
    date: dayKeyInZone(args.now, args.timeZone),
    time: args.now.toISOString(),
    clientRequestId: circuitWorkoutKey(args.runId, step.round, step.station),
  };
  if (checked.kind === 'sides') {
    payload.repsLeft = checked.left;
    payload.repsRight = checked.right;
  }
  if (checked.kind === 'distance' && checked.seconds != null) payload.durationSeconds = checked.seconds;
  if (step.loadKg != null) payload.loadKg = step.loadKg;
  return payload;
}

// ---------------------------------------------------------------------------
// Разовый круг на устройстве (R09.11): что за круг и какие станции уже записаны
// ---------------------------------------------------------------------------

export type CircuitRun = {
  /** Часть ключа тренировок станций. */
  runId: string;
  title: string;
  templateId: string | null;
  customId: string | null;
  spec: CircuitSpec;
  /** Записанные станции — id шагов (`st:<round>:<station>`). */
  done: string[];
  startedAt: string;
};

const RUN_ID_RE = /^[A-Za-z0-9_.-]{1,40}$/;

/** Ключ хранения разового круга пользователя (один незаконченный круг на аккаунт). */
export function circuitRunStorageKey(userId: string): string {
  return `circuit-run:v1:${userId}`;
}

export function newCircuitRun(args: {
  runId: string;
  title: string;
  templateId?: string | null;
  customId?: string | null;
  spec: CircuitSpec;
  now: Date;
}): CircuitRun {
  return {
    runId: args.runId,
    title: args.title,
    templateId: args.templateId ?? null,
    customId: args.customId ?? null,
    spec: {
      stations: args.spec.stations.map((s) => ({ ...s })),
      rounds: args.spec.rounds,
      restStationSec: args.spec.restStationSec,
      restRoundSec: args.spec.restRoundSec,
    },
    done: [],
    startedAt: args.now.toISOString(),
  };
}

function parseStation(raw: unknown): CircuitStation | null {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  if (!obj || !isCircuitExercise(obj.exerciseType)) return null;
  const target = Number(obj.target);
  if (!Number.isInteger(target) || target <= 0 || target > MAX_DISTANCE_METERS) return null;
  const loadKg = obj.loadKg == null ? null : normalizeLoadKg(obj.loadKg);
  return loadKg != null ? { exerciseType: obj.exerciseType, target, loadKg } : { exerciseType: obj.exerciseType, target };
}

/** Сохранённый разовый круг; испорченная или чужая запись (исключённое упражнение, плохой id) — `null`. */
export function parseCircuitRun(raw: unknown): CircuitRun | null {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  if (!obj || typeof obj.runId !== 'string' || !RUN_ID_RE.test(obj.runId)) return null;
  const specRaw = obj.spec && typeof obj.spec === 'object' ? (obj.spec as Record<string, unknown>) : null;
  if (!specRaw || !Array.isArray(specRaw.stations) || specRaw.stations.length === 0) return null;
  const stations = specRaw.stations.map(parseStation);
  if (stations.some((s) => s == null)) return null;
  const rounds = intIn(specRaw.rounds, CIRCUIT_ROUNDS_RANGE.min, CIRCUIT_ROUNDS_RANGE.max);
  const restStationSec = intIn(specRaw.restStationSec, CIRCUIT_REST_STATION_RANGE.min, CIRCUIT_REST_STATION_RANGE.max);
  const restRoundSec = intIn(specRaw.restRoundSec, CIRCUIT_REST_ROUND_RANGE.min, CIRCUIT_REST_ROUND_RANGE.max);
  if (rounds == null || restStationSec == null || restRoundSec == null) return null;
  return {
    runId: obj.runId,
    title: typeof obj.title === 'string' ? obj.title : '',
    templateId: typeof obj.templateId === 'string' ? obj.templateId : null,
    customId: typeof obj.customId === 'string' ? obj.customId : null,
    spec: { stations: stations as CircuitStation[], rounds, restStationSec, restRoundSec },
    done: Array.isArray(obj.done) ? obj.done.filter((x): x is string => typeof x === 'string') : [],
    startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : '',
  };
}
