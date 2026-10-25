/**
 * Server ↔ Health reconciliation (spec «Сверка с Health», interfaces.md §6). Pure.
 *
 * The app's own records in Health (`HealthBridge.listOwn`) are compared with the workouts on the
 * server: missing ones are written, deleted ones removed, changed ones rewritten. A record is keyed
 * by the workout's `clientRequestId` (`wid:<id>` without one) and carries `workoutFingerprint`.
 * Workouts imported from Health (`hk:` / `hc:`) are never written back.
 *
 * Формат записи 2 (R17i): fingerprint включает версию формата, вес гири, стороны и активные
 * калории записи, поэтому записи версии 1 (без калорий) при первом полном проходе переписываются.
 *
 * Тренировка «из будущего» (записали заранее на вечер — сервер это принимает) в Health не пишется,
 * пока её время не наступило (`isHealthRecordDue`): Health Connect отклоняет такие записи. Она не
 * считается ошибкой и не мешает полному проходу; её запишет первая сверка после её времени.
 */
import { getExercise } from '../exercises';
import { estimateActiveEnergy, MIN_WORKOUT_SECONDS, type BodyMetrics } from './energy';

export type ServerWorkoutForHealth = {
  id: string;
  clientRequestId: string | null;
  exerciseType: string;
  reps: number;
  durationSeconds: number | null;
  time: string;
  /** День тренировки 'YYYY-MM-DD' (или ISO): возраст для расчёта калорий. */
  date?: string | null;
  loadKg?: number | null;
  repsLeft?: number | null;
  repsRight?: number | null;
  /** Активные ккал, посчитанные сервером (null — веса не было). */
  activeKcal?: number | null;
};

/** Версия формата записи в Health: меняется — все свои записи переписываются (R17i). */
export const HEALTH_RECORD_FORMAT = 2;

/**
 * Калории записей: `enabled` — переключатель «Передавать калории в Health» (выключен — записи без
 * энергии), `body` — профиль из кэша приложения (расчёт для тренировок без серверного значения).
 */
export type HealthEnergyContext = { enabled: boolean; body?: BodyMetrics | null };

/**
 * A record the app wrote to Health. `owner` — `healthOwnerTag` of the account it was written for
 * (iOS metadata `pushup.owner`, Health Connect — prefix of `clientRecordId`); missing on records
 * written before accounts were told apart.
 */
export type OwnHealthRecord = { externalId: string; fingerprint: string; owner?: string | null };

export type HealthReconcilePlan = {
  toSave: ServerWorkoutForHealth[];
  /** External ids of the app's records to delete. */
  toDelete: string[];
  toRewrite: ServerWorkoutForHealth[];
};

export type HealthReconcileWindow = {
  /** ISO: workouts and own records from this moment are compared (`listOwn({ since })`). */
  since: string;
  /** Outbox entries of this device not on the server yet: their records stay. */
  pendingIds?: readonly string[];
  /**
   * `healthOwnerTag` of the signed-in account: records of other accounts on this phone are left
   * alone. Without it every record counts (one account).
   */
  owner?: string;
  /** Records without an owner (written by an older version) are taken over by this account. */
  claimLegacy?: boolean;
  /** Калории записей (как их пишет `toHealthWorkout`); без него — только серверные. */
  energy?: HealthEnergyContext;
  /**
   * ISO, «сейчас» на телефоне: тренировки позже него (`isHealthRecordDue`) ждут своего времени —
   * не пишутся и не переписываются, их записи не удаляются. Без него ждущих нет.
   */
  now?: string;
};

/** The regular pass looks this far back; the first one after switching on — the whole history. */
export const HEALTH_RECONCILE_DAYS = 30;

const IMPORTED_PREFIXES = ['hk:', 'hc:'];

export function isImportedFromHealth(clientRequestId: string | null | undefined): boolean {
  return Boolean(clientRequestId && IMPORTED_PREFIXES.some((prefix) => clientRequestId.startsWith(prefix)));
}

export function healthExternalId(w: Pick<ServerWorkoutForHealth, 'id' | 'clientRequestId'>): string {
  return w.clientRequestId || `wid:${w.id}`;
}

function normalizeTime(time: string): string {
  const ms = new Date(time).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : String(time);
}

/** 32-bit FNV-1a of the UTF-16 code units, as 8 hex digits. */
function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

type FingerprintSource = Pick<ServerWorkoutForHealth, 'exerciseType' | 'reps' | 'time'> &
  Partial<Pick<ServerWorkoutForHealth, 'durationSeconds' | 'loadKg' | 'repsLeft' | 'repsRight'>>;

function optionalNumber(value: number | null | undefined): number | '' {
  return value == null || !Number.isFinite(Number(value)) ? '' : Number(value);
}

/**
 * `2|exerciseType|reps|durationSeconds|time|loadKg|repsLeft|repsRight|kcal`, hashed to 8 hex digits:
 * Health Connect keeps it as the record's numeric `clientRecordVersion`, Apple Health — in the
 * workout metadata. Вес гири — только у упражнений с гирей, стороны — только у «на сторону»
 * (очередь и сервер хранят их по-разному); `energyKcal` — калории, записанные в Health (0 — без них).
 */
export function workoutFingerprint(w: FingerprintSource, energyKcal: number = 0): string {
  const exercise = getExercise(w.exerciseType);
  const own = exercise.id === w.exerciseType;
  const loadKg = own && exercise.load ? optionalNumber(w.loadKg) : '';
  const sides = own && exercise.unilateral ? [optionalNumber(w.repsLeft), optionalNumber(w.repsRight)] : ['', ''];
  const kcal = energyKcal > 0 ? (Math.round(energyKcal * 10) / 10).toFixed(1) : '0';
  return fnv1a32(
    [HEALTH_RECORD_FORMAT, w.exerciseType, w.reps, w.durationSeconds ?? '', normalizeTime(w.time), loadKg, ...sides, kcal].join('|'),
  );
}

/** День тренировки для возраста: её `date`, иначе день `time` по UTC. */
function workoutDay(w: Pick<ServerWorkoutForHealth, 'time' | 'date'>): string {
  if (w.date && /^\d{4}-\d{2}-\d{2}/.test(w.date)) return w.date.slice(0, 10);
  return normalizeTime(w.time).slice(0, 10);
}

/**
 * Активные ккал записи в Health: 0 — переключатель выключен; серверное значение тренировки; иначе
 * (очередь без связи, сервер ещё не посчитал) — `estimateActiveEnergy` по профилю на день тренировки;
 * без веса — 0 (запись без энергии).
 */
export function healthRecordEnergy(
  w: FingerprintSource & Pick<ServerWorkoutForHealth, 'date' | 'activeKcal'>,
  energy?: HealthEnergyContext,
): number {
  if (energy && !energy.enabled) return 0;
  if (typeof w.activeKcal === 'number' && Number.isFinite(w.activeKcal) && w.activeKcal > 0) return Math.round(w.activeKcal * 10) / 10;
  if (!energy?.body) return 0;
  return estimateActiveEnergy(w, energy.body, workoutDay(w)) ?? 0;
}

/** Fingerprint записи, как её пишет `toHealthWorkout`: с калориями `healthRecordEnergy`. */
export function healthRecordFingerprint(
  w: FingerprintSource & Pick<ServerWorkoutForHealth, 'date' | 'activeKcal'>,
  energy?: HealthEnergyContext,
): string {
  return workoutFingerprint(w, healthRecordEnergy(w, energy));
}

/** Short tag of an account on its Health records: 8 hex digits of `userId`, not the id itself. */
export function healthOwnerTag(userId: string): string {
  return fnv1a32(`owner:${userId}`);
}

/**
 * Запас для конца записи позже «сейчас», мс: подход программы кончается через `setNumber` секунд
 * после завершения, часы сервера и телефона расходятся. Не больше самой короткой записи
 * (`MIN_WORKOUT_SECONDS`): начало записи (конец − длительность) никогда не позже «сейчас».
 */
export const HEALTH_FUTURE_GRACE_MS = MIN_WORKOUT_SECONDS * 1000;

/**
 * Тренировку можно писать в Health: её конец (`time`) не позже `now` + `HEALTH_FUTURE_GRACE_MS`.
 * Позже — Health Connect отклонит запись («Record start time must not be in the future»); на обеих
 * платформах такая тренировка ждёт своего времени. Непонятное время — пишется (ошибку покажет Health).
 */
export function isHealthRecordDue(w: Pick<ServerWorkoutForHealth, 'time'>, now: Date): boolean {
  const endMs = new Date(w.time).getTime();
  const nowMs = now.getTime();
  if (!Number.isFinite(endMs) || !Number.isFinite(nowMs)) return true;
  return endMs <= nowMs + HEALTH_FUTURE_GRACE_MS;
}

export function reconcileSince(now: Date, days: number = HEALTH_RECONCILE_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * - `toSave`: server workouts inside the window without a record;
 * - `toRewrite`: server workouts (any time) whose record has another fingerprint, or several records,
 *   or a record without an owner that this account takes over (it gets the owner tag);
 * - `toDelete`: records (they come from the window) of no server workout and of no queued entry.
 * With `now`, a workout later than it (`isHealthRecordDue`) is in none of them: it waits for its time.
 * With `owner`, only this account's records (and, with `claimLegacy`, ones without an owner) are
 * looked at: another account's records on the same phone are never deleted or rewritten.
 */
export function planHealthReconcile(
  server: ServerWorkoutForHealth[],
  own: OwnHealthRecord[],
  window: HealthReconcileWindow,
): HealthReconcilePlan {
  const sinceMs = new Date(window.since).getTime();
  const now = window.now ? new Date(window.now) : null;
  const pending = new Set(window.pendingIds ?? []);
  const owner = window.owner;
  const mine = owner === undefined ? own : own.filter((r) => (r.owner ? r.owner === owner : Boolean(window.claimLegacy)));
  const recordsById = new Map<string, OwnHealthRecord[]>();
  for (const record of mine) {
    const list = recordsById.get(record.externalId);
    if (list) list.push(record);
    else recordsById.set(record.externalId, [record]);
  }

  const serverIds = new Set<string>();
  const toSave: ServerWorkoutForHealth[] = [];
  const toRewrite: ServerWorkoutForHealth[] = [];
  for (const w of server) {
    if (isImportedFromHealth(w.clientRequestId)) continue;
    const externalId = healthExternalId(w);
    if (serverIds.has(externalId)) continue;
    serverIds.add(externalId);
    if (now && !isHealthRecordDue(w, now)) continue; // ждёт своего времени; его запись не удаляется
    const records = recordsById.get(externalId);
    if (!records) {
      if (new Date(w.time).getTime() >= sinceMs) toSave.push(w);
      continue;
    }
    const fingerprint = healthRecordFingerprint(w, window.energy);
    const untagged = owner !== undefined && !records[0].owner;
    if (records.length > 1 || untagged || records[0].fingerprint !== fingerprint) toRewrite.push(w);
  }

  const toDelete = [...recordsById.keys()].filter((id) => !serverIds.has(id) && !pending.has(id));
  return { toSave, toDelete, toRewrite };
}
