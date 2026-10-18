/**
 * Apple Health / Health Connect facade (interfaces.md §6). On the site everything here reports
 * «unavailable» and does nothing.
 *
 * - `syncWorkoutToHealth` / `removeWorkoutFromHealth` — right when a workout is saved, edited or
 *   deleted in the app (also offline: the record is local), quietly; errors go to the console.
 * - `reconcileHealth` — brings the app's records in Health in line with the server (workouts made
 *   on the site or in Telegram, deleted, changed): the whole history the first time after switching
 *   on (batches of 100, `healthReconcileProgress {done,total}`), afterwards the last 30 days.
 *   `installHealthSync` runs it at start, on resume and after the outbox went out (`outboxFlushed`).
 * - `listImportableCardio` / `importHealthSessions` — the «Импорт из Health» screen: runs, rides and
 *   rows of the last 30 days that are not in the tracker yet, and sending the chosen ones.
 *
 * Per account (story 52): the switch is kept per user, every record is tagged with
 * `healthOwnerTag(userId)` and the reconcile looks only at the signed-in account's records, so
 * another account on the same phone never deletes or rewrites them. The account is the one passed
 * in, else the signed-in user of the app (`readCachedUser`). Records and the switch of an older
 * version (no owner) are taken over by the first account that reconciles.
 */

import { registerPlugin } from '@capacitor/core';
import { readCachedUser } from '@/lib/native-auth';
import { nativePlatform } from '@/lib/platform';
import { outboxStore } from '@/lib/offline/outbox-store';
import { OUTBOX_FLUSHED_EVENT } from '@/lib/offline/sync';
import {
  healthClientRequestId,
  toHealthWorkout,
  toImportCandidate,
  type HealthPlatform,
  type HealthSession,
  type HealthWorkoutInput,
  type HealthWorkoutSource,
  type ImportCandidate,
} from './mapping';
import {
  healthExternalId,
  healthOwnerTag,
  isImportedFromHealth,
  planHealthReconcile,
  reconcileSince,
  type OwnHealthRecord,
  type ServerWorkoutForHealth,
} from './reconcile';

export type HealthUnavailableReason = 'not_supported' | 'not_installed' | 'update_required';
export type HealthAvailability = { available: boolean; reason?: HealthUnavailableReason };
export type HealthReconcileProgress = { done: number; total: number };
export type HealthReconcileResult = { saved: number; rewritten: number; deleted: number; failed: number };

type HealthBridgePlugin = {
  isAvailable(): Promise<HealthAvailability>;
  requestPermissions(): Promise<{ granted: boolean }>;
  saveWorkout(input: HealthWorkoutInput): Promise<{ saved: boolean; skipped?: 'exists' }>;
  /** Deletes the records of `externalId` of `owner` and those without an owner; never another account's. */
  deleteWorkout(options: { externalId: string; owner?: string }): Promise<{ deleted: boolean }>;
  listOwn(options: { since: string }): Promise<{ records: OwnHealthRecord[] }>;
  querySessions(options: { since: string }): Promise<{ sessions: HealthSession[] }>;
  openSettings(): Promise<void>;
};

export const HEALTH_RECONCILE_PROGRESS_EVENT = 'healthReconcileProgress';
export const HEALTH_RECONCILE_BATCH_SIZE = 100;
/** Before accounts were told apart: one switch for the phone. Taken over by the first account. */
const LEGACY_ENABLED_KEY = 'health-write-enabled:v1';
const ENABLED_KEY = 'health-write-enabled:v2';
const FULL_DONE_KEY = 'health-full-sync:v1';
/** Set once records without an owner were taken over (by the first account that reconciled). */
const LEGACY_CLAIMED_KEY = 'health-owner-claimed:v1';
/** Since when the first pass after switching on looks: the whole history. */
const FULL_SINCE = '1970-01-01T00:00:00.000Z';
const PROGRESS_STEP = 10;

let plugin: HealthBridgePlugin | null = null;

function bridge(): HealthBridgePlugin {
  if (!plugin) plugin = registerPlugin<HealthBridgePlugin>('HealthBridge');
  return plugin;
}

export function healthPlatform(): HealthPlatform | null {
  const platform = nativePlatform();
  if (platform === 'ios') return 'apple_health';
  if (platform === 'android') return 'health_connect';
  return null;
}

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {
    // Private mode / storage off: the switch just does not stick.
  }
}

/** The account Health works for: the given one, else the signed-in user of the app. */
function healthUserId(userId?: string | null): string | null {
  return userId || readCachedUser()?.id || null;
}

/** Another account is signed in now (not just «nobody yet»: the cache is written after sign-in). */
function anotherUserSignedIn(userId: string): boolean {
  const current = readCachedUser()?.id;
  return Boolean(current && current !== userId);
}

function enabledKey(userId: string): string {
  return `${ENABLED_KEY}:${userId}`;
}

/** The phone-wide switch of an older version becomes the switch of the first account that asks. */
function claimLegacySwitch(userId: string): void {
  if (!readFlag(LEGACY_ENABLED_KEY)) return;
  writeFlag(enabledKey(userId), true);
  writeFlag(LEGACY_ENABLED_KEY, false);
}

/** Writing to Health is on for this account (`userId`, else the signed-in user). */
export function isHealthWriteEnabled(userId?: string | null): boolean {
  if (healthPlatform() === null) return false;
  const user = healthUserId(userId);
  if (!user) return false;
  claimLegacySwitch(user);
  return readFlag(enabledKey(user));
}

/** Switching off also forgets the first full pass: switching on again re-checks the whole history. */
export function setHealthWriteEnabled(on: boolean, userId?: string | null): void {
  const user = healthUserId(userId);
  if (!user) return;
  writeFlag(enabledKey(user), on);
  if (!on) writeFlag(fullDoneKey(user), false);
}

/** Account deleted on this phone: its switch and passes are forgotten (its records stay in Health). */
export function forgetHealthUser(userId: string): void {
  writeFlag(enabledKey(userId), false);
  writeFlag(fullDoneKey(userId), false);
}

function locale(): 'ru' | 'en' {
  if (typeof document === 'undefined') return 'ru';
  return document.documentElement.lang?.startsWith('en') ? 'en' : 'ru';
}

export async function healthAvailability(): Promise<HealthAvailability> {
  if (!healthPlatform()) return { available: false, reason: 'not_supported' };
  try {
    return await bridge().isAvailable();
  } catch (error) {
    console.error('Health availability check failed', error);
    return { available: false, reason: 'not_supported' };
  }
}

export async function requestHealthPermissions(): Promise<boolean> {
  if (!healthPlatform()) return false;
  const { granted } = await bridge().requestPermissions();
  return granted;
}

/** Health settings (permissions); on Android without Health Connect — its page in Google Play. */
export async function openHealthSettings(): Promise<void> {
  if (!healthPlatform()) return;
  try {
    await bridge().openSettings();
  } catch (error) {
    console.error('Could not open Health settings', error);
  }
}

function toInput(w: HealthWorkoutSource, owner: string): HealthWorkoutInput | null {
  const platform = healthPlatform();
  if (!platform) return null;
  return { ...toHealthWorkout(w, platform, locale()), owner };
}

/**
 * Writes (or, when it changed, rewrites) one workout of `userId` (else the signed-in user);
 * `clientRequestId` is its Health key — `healthExternalId` for a server record. Workouts imported
 * from Health are not written back.
 */
export async function syncWorkoutToHealth(w: HealthWorkoutSource, userId?: string | null): Promise<void> {
  const user = healthUserId(userId);
  if (!user || !isHealthWriteEnabled(user) || isImportedFromHealth(w.clientRequestId)) return;
  const input = toInput(w, healthOwnerTag(user));
  if (!input) return;
  try {
    await bridge().saveWorkout(input);
  } catch (error) {
    console.error('Could not save the workout to Health', error);
  }
}

export async function removeWorkoutFromHealth(clientRequestId: string, userId?: string | null): Promise<void> {
  const user = healthUserId(userId);
  if (!user || !isHealthWriteEnabled(user) || !clientRequestId) return;
  try {
    await bridge().deleteWorkout({ externalId: clientRequestId, owner: healthOwnerTag(user) });
  } catch (error) {
    console.error('Could not delete the workout from Health', error);
  }
}

function emitProgress(progress: HealthReconcileProgress): void {
  window.dispatchEvent(new CustomEvent<HealthReconcileProgress>(HEALTH_RECONCILE_PROGRESS_EVENT, { detail: progress }));
}

function fullDoneKey(userId: string): string {
  return `${FULL_DONE_KEY}:${userId}`;
}

async function loadServerWorkouts(): Promise<ServerWorkoutForHealth[]> {
  const response = await fetch('/api/workouts', { cache: 'no-store' });
  if (!response.ok) throw new Error(`GET /api/workouts → ${response.status}`);
  const data: unknown = await response.json();
  if (!Array.isArray(data)) throw new Error('GET /api/workouts: not a list');
  return data.map((raw) => {
    const w = raw as Record<string, unknown>;
    return {
      id: String(w.id),
      clientRequestId: typeof w.clientRequestId === 'string' ? w.clientRequestId : null,
      exerciseType: String(w.exerciseType),
      reps: Number(w.reps),
      durationSeconds: typeof w.durationSeconds === 'number' ? w.durationSeconds : null,
      time: String(w.time ?? w.date),
    };
  });
}

/** Entries still waiting on this device (their records stay); «будет удалена» ones do not count. */
async function pendingOutboxIds(userId: string): Promise<string[]> {
  try {
    return (await outboxStore.list(userId)).filter((item) => !item.deleteOnServer).map((item) => item.id);
  } catch {
    return [];
  }
}

type ReconcileOptions = { full?: boolean; userId?: string };

async function runReconcile(options: ReconcileOptions): Promise<HealthReconcileResult | null> {
  const userId = healthUserId(options.userId);
  if (!userId || !isHealthWriteEnabled(userId)) return null;
  const owner = healthOwnerTag(userId);
  // Records of an older version (no owner) are taken over once, over the whole history.
  const claimLegacy = !readFlag(LEGACY_CLAIMED_KEY);
  const full = Boolean(options.full) || claimLegacy || !readFlag(fullDoneKey(userId));
  const since = full ? FULL_SINCE : reconcileSince(new Date());
  const [server, own, pendingIds] = await Promise.all([
    loadServerWorkouts(),
    bridge().listOwn({ since }).then((r) => r.records),
    pendingOutboxIds(userId),
  ]);
  // Another account signed in meanwhile: its workouts must not be matched against these records.
  if (anotherUserSignedIn(userId)) return null;
  const plan = planHealthReconcile(server, own, { since, pendingIds, owner, claimLegacy });
  // Newest first: the recent days appear in Health before the old history.
  const byNewest = (a: ServerWorkoutForHealth, b: ServerWorkoutForHealth) => b.time.localeCompare(a.time);
  type Step = { kind: 'delete'; externalId: string } | { kind: 'rewrite' | 'save'; workout: ServerWorkoutForHealth };
  const steps: Step[] = [
    ...plan.toDelete.map((externalId): Step => ({ kind: 'delete', externalId })),
    ...[...plan.toRewrite].sort(byNewest).map((workout): Step => ({ kind: 'rewrite', workout })),
    ...[...plan.toSave].sort(byNewest).map((workout): Step => ({ kind: 'save', workout })),
  ];
  const result: HealthReconcileResult = { saved: 0, rewritten: 0, deleted: 0, failed: 0 };
  const total = steps.length;
  if (full) emitProgress({ done: 0, total });

  for (let start = 0; start < total; start += HEALTH_RECONCILE_BATCH_SIZE) {
    if (!isHealthWriteEnabled(userId) || anotherUserSignedIn(userId)) return result; // switched off or signed out mid-way
    const batch = steps.slice(start, start + HEALTH_RECONCILE_BATCH_SIZE);
    for (let i = 0; i < batch.length; i += 1) {
      const step = batch[i];
      try {
        if (step.kind === 'delete') {
          await bridge().deleteWorkout({ externalId: step.externalId, owner });
          result.deleted += 1;
        } else {
          const input = toInput({ ...step.workout, clientRequestId: healthExternalId(step.workout) }, owner);
          if (input) await bridge().saveWorkout(input);
          if (step.kind === 'rewrite') result.rewritten += 1;
          else result.saved += 1;
        }
      } catch (error) {
        result.failed += 1;
        console.error('Health reconcile step failed', step.kind, error);
        // No permission any more, or nothing works at all: the rest would fail the same way.
        const code = (error as { code?: unknown } | null)?.code;
        if (code === 'not_authorized' || (result.failed >= 3 && result.failed === start + i + 1)) throw error;
      }
      const done = start + i + 1;
      if (full && (done % PROGRESS_STEP === 0 || i === batch.length - 1)) emitProgress({ done, total });
    }
  }
  if (full && result.failed === 0) {
    writeFlag(fullDoneKey(userId), true);
    if (claimLegacy) writeFlag(LEGACY_CLAIMED_KEY, true);
  }
  return result;
}

let running: Promise<HealthReconcileResult | null> | null = null;
let next: { options: ReconcileOptions; promise: Promise<HealthReconcileResult | null> } | null = null;

/**
 * One pass at a time; requests during a pass are merged into one more pass after it (`full` wins).
 * Resolves `null` when writing is off; rejects when Health or the server can't be read.
 */
export function reconcileHealth(options: ReconcileOptions = {}): Promise<HealthReconcileResult | null> {
  if (!isHealthWriteEnabled(options.userId)) return Promise.resolve(null);
  if (!running) {
    running = runReconcile(options).finally(() => {
      running = null;
    });
    return running;
  }
  if (next) {
    next.options.full = Boolean(next.options.full || options.full);
    next.options.userId = options.userId ?? next.options.userId; // the newest sign-in wins
    return next.promise;
  }
  const merged: ReconcileOptions = { ...options };
  const promise = running
    .catch(() => null)
    .then(() => {
      next = null;
      return reconcileHealth(merged);
    });
  next = { options: merged, promise };
  return promise;
}

let installedFor: string | null = null;

/** Start, resume and «outbox went out» triggers of the regular pass; once per app run and user. */
export function installHealthSync(userId: string): void {
  if (!healthPlatform() || installedFor === userId) return;
  const first = installedFor === null;
  installedFor = userId;
  const kick = () => {
    if (!installedFor) return;
    reconcileHealth({ userId: installedFor }).catch((error) => console.error('Health reconcile failed', error));
  };
  kick();
  if (!first) return;
  window.addEventListener(OUTBOX_FLUSHED_EVENT, kick);
  void import('@capacitor/app')
    .then(({ App }) => App.addListener('resume', kick))
    .catch(() => undefined);
}

// --- Import of run / bike / row ---

/** How far back the import screen looks. */
export const HEALTH_IMPORT_DAYS = 30;
const IMPORTED_QUERY_CHUNK = 500;
const IMPORT_CHUNK = 50;

/** The user has not allowed reading workouts in Health (or Health Connect). */
export class HealthNotAuthorizedError extends Error {
  constructor() {
    super('No permission to read workouts from Health');
    this.name = 'HealthNotAuthorizedError';
  }
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`POST ${path} → ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Sessions of the last 30 days from Health that are worth showing: not written by this app, not
 * imported before; newest first. Not-importable ones (too short, too long) stay with a `reason`.
 * Asks for the Health permissions first (a dialog only while the system still asks).
 * Throws `HealthNotAuthorizedError` when reading is not allowed.
 */
export async function listImportableCardio(timeZone: string, now: Date = new Date()): Promise<ImportCandidate[]> {
  if (!healthPlatform()) return [];
  await requestHealthPermissions().catch(() => false);
  const since = new Date(now.getTime() - HEALTH_IMPORT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let sessions: HealthSession[];
  try {
    sessions = (await bridge().querySessions({ since })).sessions;
  } catch (error) {
    if ((error as { code?: unknown } | null)?.code === 'not_authorized') throw new HealthNotAuthorizedError();
    throw error;
  }
  const own = sessions.filter((s) => !s.fromThisApp);
  const keys = own.map((s) => healthClientRequestId(s));
  const known = new Set<string>();
  for (let start = 0; start < keys.length; start += IMPORTED_QUERY_CHUNK) {
    const { imported } = await postJson<{ imported: string[] }>('/api/health/imported', { clientRequestIds: keys.slice(start, start + IMPORTED_QUERY_CHUNK) });
    for (const id of imported) known.add(id);
  }
  return own
    .filter((_, i) => !known.has(keys[i]))
    .map((s) => toImportCandidate(s, timeZone))
    .sort((a, b) => b.session.end.localeCompare(a.session.end));
}

export type HealthImportOutcome = { clientRequestId: string; status: 'created' | 'duplicate' | 'rejected'; workoutId?: string; error?: string };

/** Sends the chosen candidates (≤ 50 per request) and returns the server's verdict per session. */
export async function importHealthSessions(candidates: ImportCandidate[]): Promise<HealthImportOutcome[]> {
  const items = candidates.flatMap((c) => (c.workout ? [c.workout] : []));
  const outcomes: HealthImportOutcome[] = [];
  for (let start = 0; start < items.length; start += IMPORT_CHUNK) {
    const { results } = await postJson<{ results: HealthImportOutcome[] }>('/api/health/import', { items: items.slice(start, start + IMPORT_CHUNK) });
    outcomes.push(...results);
  }
  return outcomes;
}
