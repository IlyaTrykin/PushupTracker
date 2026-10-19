/**
 * Активные калории тренировок на сервере (`Workout.activeKcal`).
 *
 * Калории тренировки считаются один раз — при записи (`createWorkoutForUser`) и при правке
 * повторов/сторон/веса гири/времени/упражнения — по телу пользователя на этот момент и хранятся;
 * смена веса в профиле прошлые значения не трогает. Исключение — досчёт: когда вес появляется
 * впервые, тренировки без калорий получают их по весу на свою дату из истории профиля
 * (`backfillWorkoutEnergy`). Калории видит только сам пользователь (`hideForeignEnergy`).
 */
import { dbDateToDayKey } from './calendar-day';
import { estimateActiveEnergy, type BodyMetrics, type EnergySource } from './health/energy';

export type EnergyBodyRow = { weightKg: number | null; heightCm?: number | null; birthDate?: Date | null; gender?: string | null };
export type WeightHistoryRow = { changedAt: Date; changes: unknown };
export type EnergyWorkoutRow = EnergySource & { id: string; date: Date; time: Date };
export type EnergyEditRow = EnergySource & { date: Date; activeKcal?: number | null };

/** Поля пользователя, нужные расчёту калорий. */
export const ENERGY_BODY_SELECT = { weightKg: true, heightCm: true, birthDate: true, gender: true } as const;

const SEXES = new Set(['male', 'female', 'other']);

/** Строка пользователя из БД → вход калькулятора. */
export function toBodyMetrics(row: EnergyBodyRow | null | undefined): BodyMetrics {
  const gender = row?.gender ?? null;
  return {
    weightKg: row?.weightKg ?? null,
    heightCm: row?.heightCm ?? null,
    birthDate: row?.birthDate ? row.birthDate.toISOString().slice(0, 10) : null,
    sex: gender && SEXES.has(gender) ? (gender as BodyMetrics['sex']) : null,
  };
}

/** Калории тренировки по телу `body`; возраст — на день тренировки. */
export function workoutActiveKcal(w: EnergySource & { date: Date }, body: BodyMetrics): number | null {
  return estimateActiveEnergy(w, body, dbDateToDayKey(w.date));
}

function weightValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

type WeightChange = { at: number; from: number | null; to: number | null };

function weightChanges(history: WeightHistoryRow[]): WeightChange[] {
  const out: WeightChange[] = [];
  for (const row of history) {
    const changes = row.changes;
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) continue;
    const change = (changes as Record<string, unknown>).weightKg;
    if (!change || typeof change !== 'object') continue;
    const { from, to } = change as { from?: unknown; to?: unknown };
    out.push({ at: row.changedAt.getTime(), from: weightValue(from), to: weightValue(to) });
  }
  return out.sort((a, b) => a.at - b.at);
}

function weightAtMoment(changes: WeightChange[], at: number, currentKg: number | null): number | null {
  if (!changes.length) return weightValue(currentKg);
  let prior: WeightChange | null = null;
  for (const c of changes) if (c.at <= at) prior = c;
  const inForce = prior ? prior.to : changes[0].from;
  if (inForce !== null) return inForce;
  // В тот момент веса не было: ближайший известный позже, иначе текущий.
  const later = changes.find((c) => c.at > at && c.to !== null);
  return later?.to ?? weightValue(currentKg);
}

/**
 * Вес, действовавший в момент `at`, по истории профиля (`changes.weightKg = {from, to}`):
 * последнее изменение до `at`, до первого изменения — его `from`; если веса тогда не было —
 * ближайший известный позже; без истории веса — текущий.
 */
export function weightAt(history: WeightHistoryRow[], at: Date, currentKg: number | null): number | null {
  return weightAtMoment(weightChanges(history), at.getTime(), currentKg);
}

/** Калории для тренировок без них: вес — на момент тренировки, остальное — текущий профиль. */
export function planEnergyBackfill(
  workouts: EnergyWorkoutRow[],
  body: EnergyBodyRow,
  history: WeightHistoryRow[],
): { id: string; activeKcal: number }[] {
  const base = toBodyMetrics(body);
  const changes = weightChanges(history);
  const out: { id: string; activeKcal: number }[] = [];
  for (const w of workouts) {
    const weightKg = weightAtMoment(changes, w.time.getTime(), base.weightKg);
    const activeKcal = workoutActiveKcal(w, { ...base, weightKg });
    if (activeKcal !== null) out.push({ id: w.id, activeKcal });
  }
  return out;
}

function sameNumber(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

/**
 * Калории после правки тренировки: пересчёт, если изменилось то, от чего они зависят (упражнение,
 * повторы, стороны, вес гири, время дистанции) или их ещё не было; `undefined` — не трогать
 * (перенос на другой день не пересчитывает по нынешнему весу).
 */
export function editedWorkoutEnergy(before: EnergyEditRow, after: EnergyEditRow, body: BodyMetrics): number | null | undefined {
  const changed =
    before.exerciseType !== after.exerciseType ||
    before.reps !== after.reps ||
    !sameNumber(before.repsLeft, after.repsLeft) ||
    !sameNumber(before.repsRight, after.repsRight) ||
    !sameNumber(before.loadKg, after.loadKg) ||
    !sameNumber(before.durationSeconds, after.durationSeconds);
  if (!changed && before.activeKcal != null) return undefined;
  return workoutActiveKcal(after, body);
}

/** Вес появился впервые (из пусто в значение) — пора досчитать калории старых тренировок. */
export function weightAppeared(before: number | null | undefined, after: number | null | undefined): boolean {
  return before == null && after != null;
}

/** Ответ API: свои тренировки — с калориями, чужие (владелец группы, админ) — без поля. */
export function hideForeignEnergy<T extends { activeKcal?: number | null }>(workout: T, own: boolean): T | Omit<T, 'activeKcal'> {
  if (own) return workout;
  const { activeKcal, ...rest } = workout;
  void activeKcal;
  return rest;
}

export type EnergyBackfillDeps = {
  loadBody(userId: string): Promise<EnergyBodyRow | null>;
  loadWeightHistory(userId: string): Promise<WeightHistoryRow[]>;
  /** Тренировки пользователя с `activeKcal IS NULL`, по возрастанию id, после `afterId`. */
  loadWorkoutsWithoutEnergy(userId: string, afterId: string | null, take: number): Promise<EnergyWorkoutRow[]>;
  /** Пишет калории только туда, где их ещё нет; возвращает число изменённых строк. */
  saveEnergy(rows: { id: string; activeKcal: number }[]): Promise<number>;
};

export type EnergyBackfillOptions = { dryRun?: boolean; batchSize?: number };
export type EnergyBackfillResult = { pending: number; updated: number };

const BACKFILL_BATCH_SIZE = 500;

/** `backfillWorkoutEnergy` над заданными зависимостями (тесты передают подделки). */
export function createEnergyBackfill(deps: EnergyBackfillDeps) {
  return async function backfill(userId: string, opts: EnergyBackfillOptions = {}): Promise<EnergyBackfillResult> {
    const body = await deps.loadBody(userId);
    if (!body || weightValue(body.weightKg) === null) return { pending: 0, updated: 0 };
    const history = await deps.loadWeightHistory(userId);
    const take = Math.max(1, opts.batchSize ?? BACKFILL_BATCH_SIZE);

    let pending = 0;
    let updated = 0;
    let afterId: string | null = null;
    for (;;) {
      const batch = await deps.loadWorkoutsWithoutEnergy(userId, afterId, take);
      if (!batch.length) break;
      afterId = batch[batch.length - 1].id;
      const rows = planEnergyBackfill(batch, body, history);
      pending += rows.length;
      if (!opts.dryRun && rows.length) updated += await deps.saveEnergy(rows);
      if (batch.length < take) break;
    }
    return { pending, updated };
  };
}

async function db() {
  return (await import('./prisma')).prisma;
}

const prismaBackfillDeps: EnergyBackfillDeps = {
  loadBody: async (userId) =>
    (await db()).user.findFirst({ where: { id: userId, deletedAt: null }, select: ENERGY_BODY_SELECT }),
  // История профиля короткая (запись на сохранение профиля); строки без веса отсеет weightChanges.
  loadWeightHistory: async (userId) =>
    (await db()).userProfileHistory.findMany({
      where: { userId },
      orderBy: { changedAt: 'asc' },
      select: { changedAt: true, changes: true },
    }),
  loadWorkoutsWithoutEnergy: async (userId, afterId, take) =>
    (await db()).workout.findMany({
      where: { userId, activeKcal: null, ...(afterId ? { id: { gt: afterId } } : {}) },
      orderBy: { id: 'asc' },
      take,
      select: {
        id: true,
        exerciseType: true,
        reps: true,
        repsLeft: true,
        repsRight: true,
        loadKg: true,
        durationSeconds: true,
        date: true,
        time: true,
      },
    }),
  saveEnergy: async (rows) => {
    const { Prisma } = await import('@prisma/client');
    const values = Prisma.join(rows.map((r) => Prisma.sql`(${r.id}, ${r.activeKcal}::double precision)`));
    return (await db()).$executeRaw`
      UPDATE "Workout" AS w SET "activeKcal" = v.kcal
      FROM (VALUES ${values}) AS v(id, kcal)
      WHERE w.id = v.id AND w."activeKcal" IS NULL`;
  },
};

/**
 * Досчитывает калории всем тренировкам пользователя без них (вес на дату — из истории профиля,
 * иначе текущий). Идемпотентно: заполненные значения не трогает. Без веса ничего не делает.
 */
export const backfillWorkoutEnergy = createEnergyBackfill(prismaBackfillDeps);
