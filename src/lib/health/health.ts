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
 */

import { registerPlugin } from '@capacitor/core';
import { nativePlatform } from '@/lib/platform';
import { outboxStore } from '@/lib/offline/outbox-store';
import { OUTBOX_FLUSHED_EVENT } from '@/lib/offline/sync';
import { toHealthWorkout, type HealthPlatform, type HealthWorkoutInput, type HealthWorkoutSource } from './mapping';
import {
  healthExternalId,
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
  deleteWorkout(options: { externalId: string }): Promise<{ deleted: boolean }>;
  listOwn(options: { since: string }): Promise<{ records: OwnHealthRecord[] }>;
  openSettings(): Promise<void>;
};

export const HEALTH_RECONCILE_PROGRESS_EVENT = 'healthReconcileProgress';
export const HEALTH_RECONCILE_BATCH_SIZE = 100;
const ENABLED_KEY = 'health-write-enabled:v1';
const FULL_DONE_KEY = 'health-full-sync:v1';
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

export function isHealthWriteEnabled(): boolean {
  return healthPlatform() !== null && readFlag(ENABLED_KEY);
}

/** Switching off also forgets the first full pass: switching on again re-checks the whole history. */
export function setHealthWriteEnabled(on: boolean): void {
  writeFlag(ENABLED_KEY, on);
  if (on) return;
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key?.startsWith(`${FULL_DONE_KEY}:`)) storage.removeItem(key);
  } catch {
    // nothing stored
  }
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

function toInput(w: HealthWorkoutSource): HealthWorkoutInput | null {
  const platform = healthPlatform();
  if (!platform) return null;
  return toHealthWorkout(w, platform, locale());
}

/**
 * Writes (or, when it changed, rewrites) one workout; `clientRequestId` is its Health key —
 * `healthExternalId` for a server record. Workouts imported from Health are not written back.
 */
export async function syncWorkoutToHealth(w: HealthWorkoutSource): Promise<void> {
  if (!isHealthWriteEnabled() || isImportedFromHealth(w.clientRequestId)) return;
  const input = toInput(w);
  if (!input) return;
  try {
    await bridge().saveWorkout(input);
  } catch (error) {
    console.error('Could not save the workout to Health', error);
  }
}

export async function removeWorkoutFromHealth(clientRequestId: string): Promise<void> {
  if (!isHealthWriteEnabled() || !clientRequestId) return;
  try {
    await bridge().deleteWorkout({ externalId: clientRequestId });
  } catch (error) {
    console.error('Could not delete the workout from Health', error);
  }
}

function emitProgress(progress: HealthReconcileProgress): void {
  window.dispatchEvent(new CustomEvent<HealthReconcileProgress>(HEALTH_RECONCILE_PROGRESS_EVENT, { detail: progress }));
}

function fullDoneKey(userId: string | undefined): string {
  return `${FULL_DONE_KEY}:${userId || 'anon'}`;
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

async function pendingOutboxIds(userId: string | undefined): Promise<string[]> {
  if (!userId) return [];
  try {
    return (await outboxStore.list(userId)).map((item) => item.id);
  } catch {
    return [];
  }
}

type ReconcileOptions = { full?: boolean; userId?: string };

async function runReconcile(options: ReconcileOptions): Promise<HealthReconcileResult | null> {
  if (!isHealthWriteEnabled()) return null;
  const full = Boolean(options.full) || !readFlag(fullDoneKey(options.userId));
  const since = full ? FULL_SINCE : reconcileSince(new Date());
  const [server, own, pendingIds] = await Promise.all([
    loadServerWorkouts(),
    bridge().listOwn({ since }).then((r) => r.records),
    pendingOutboxIds(options.userId),
  ]);
  const plan = planHealthReconcile(server, own, { since, pendingIds });
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
    if (!isHealthWriteEnabled()) return result; // switched off mid-way
    const batch = steps.slice(start, start + HEALTH_RECONCILE_BATCH_SIZE);
    for (let i = 0; i < batch.length; i += 1) {
      const step = batch[i];
      try {
        if (step.kind === 'delete') {
          await bridge().deleteWorkout({ externalId: step.externalId });
          result.deleted += 1;
        } else {
          const input = toInput({ ...step.workout, clientRequestId: healthExternalId(step.workout) });
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
  if (full && result.failed === 0) writeFlag(fullDoneKey(options.userId), true);
  return result;
}

let running: Promise<HealthReconcileResult | null> | null = null;
let next: { options: ReconcileOptions; promise: Promise<HealthReconcileResult | null> } | null = null;

/**
 * One pass at a time; requests during a pass are merged into one more pass after it (`full` wins).
 * Resolves `null` when writing is off; rejects when Health or the server can't be read.
 */
export function reconcileHealth(options: ReconcileOptions = {}): Promise<HealthReconcileResult | null> {
  if (!isHealthWriteEnabled()) return Promise.resolve(null);
  if (!running) {
    running = runReconcile(options).finally(() => {
      running = null;
    });
    return running;
  }
  if (next) {
    next.options.full = Boolean(next.options.full || options.full);
    next.options.userId = next.options.userId ?? options.userId;
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
