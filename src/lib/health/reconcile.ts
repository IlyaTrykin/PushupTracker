/**
 * Server ↔ Health reconciliation (spec «Сверка с Health», interfaces.md §6). Pure.
 *
 * The app's own records in Health (`HealthBridge.listOwn`) are compared with the workouts on the
 * server: missing ones are written, deleted ones removed, changed ones rewritten. A record is keyed
 * by the workout's `clientRequestId` (`wid:<id>` without one) and carries `workoutFingerprint`.
 * Workouts imported from Health (`hk:` / `hc:`) are never written back.
 */

export type ServerWorkoutForHealth = {
  id: string;
  clientRequestId: string | null;
  exerciseType: string;
  reps: number;
  durationSeconds: number | null;
  time: string;
};

export type OwnHealthRecord = { externalId: string; fingerprint: string };

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

/**
 * `exerciseType|reps|durationSeconds|time`, hashed to 8 hex digits: Health Connect keeps it as the
 * record's numeric `clientRecordVersion`, Apple Health — in the workout metadata.
 */
export function workoutFingerprint(
  w: Pick<ServerWorkoutForHealth, 'exerciseType' | 'reps' | 'time'> & { durationSeconds?: number | null },
): string {
  return fnv1a32([w.exerciseType, w.reps, w.durationSeconds ?? '', normalizeTime(w.time)].join('|'));
}

export function reconcileSince(now: Date, days: number = HEALTH_RECONCILE_DAYS): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

/**
 * - `toSave`: server workouts inside the window without a record;
 * - `toRewrite`: server workouts (any time) whose record has another fingerprint, or several records;
 * - `toDelete`: records (they come from the window) of no server workout and of no queued entry.
 */
export function planHealthReconcile(
  server: ServerWorkoutForHealth[],
  own: OwnHealthRecord[],
  window: HealthReconcileWindow,
): HealthReconcilePlan {
  const sinceMs = new Date(window.since).getTime();
  const pending = new Set(window.pendingIds ?? []);
  const recordsById = new Map<string, OwnHealthRecord[]>();
  for (const record of own) {
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
    const records = recordsById.get(externalId);
    if (!records) {
      if (new Date(w.time).getTime() >= sinceMs) toSave.push(w);
      continue;
    }
    const fingerprint = workoutFingerprint(w);
    if (records.length > 1 || records[0].fingerprint !== fingerprint) toRewrite.push(w);
  }

  const toDelete = [...recordsById.keys()].filter((id) => !serverIds.has(id) && !pending.has(id));
  return { toSave, toDelete, toRewrite };
}
