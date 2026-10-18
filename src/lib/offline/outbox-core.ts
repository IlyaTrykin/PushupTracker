/**
 * Offline outbox of new workouts — the pure core (no IndexedDB, no fetch).
 *
 * Every workout from the dashboard is first put here and then sent with a constant
 * `clientRequestId`, so a resend never creates a duplicate (the server replays the record).
 * The entry keeps its own day (`date`, the user's calendar day) and instant (`time`, ISO),
 * so a workout sent hours later still belongs to the day it was done on.
 */

import { dayKeyInZone, localHHMM, zonedTimeToInstant, type DayKey } from '@/lib/calendar-day';
import { newClientRequestId } from '@/lib/client-request-id';
import { calculateExercisePoints, pointsToTenths, tenthsToPoints } from '@/lib/exercise-points';
import { isDistanceExercise } from '@/lib/exercises';

export type OutboxPayload = {
  exerciseType: string;
  reps: number;
  loadKg?: number | null;
  repsLeft?: number | null;
  repsRight?: number | null;
  durationSeconds?: number | null;
  date: DayKey;
  /** ISO instant. */
  time: string;
  clientRequestId: string;
  trainingSessionId?: string;
};

export type OutboxStatus = 'pending' | 'sending' | 'rejected';

export type OutboxItem = {
  /** = payload.clientRequestId */
  id: string;
  userId: string;
  payload: OutboxPayload;
  createdAt: string;
  attempts: number;
  status: OutboxStatus;
  /** pending: not before this instant; sending: the lease of the sender ends at this instant. */
  nextAttemptAt: string | null;
  lastError: string | null;
};

export type SendOutcome =
  | { kind: 'created' | 'replayed'; workoutId: string; response?: unknown }
  | { kind: 'rejected'; status: number; message: string } // 400/403/404/409/413/415
  | { kind: 'rate-limited'; retryAfterSeconds: number } // 429
  | { kind: 'unauthorized' } // 401
  | { kind: 'retry'; reason: string }; // network, 5xx

export type NewOutboxPayload = Omit<OutboxPayload, 'clientRequestId'> & { clientRequestId?: string };
export type OutboxPayloadPatch = Partial<Omit<OutboxPayload, 'clientRequestId'>>;

/** How long a sender owns an item; after that a crashed or closed tab's item is sent again. */
export const SENDING_LEASE_SECONDS = 120;
/** Pause after 429 without a usable Retry-After. */
export const DEFAULT_RETRY_AFTER_SECONDS = 60;

const BACKOFF_STEPS_SECONDS = [5, 15, 60, 300, 900];

function plusSeconds(now: Date, seconds: number): string {
  return new Date(now.getTime() + seconds * 1000).toISOString();
}

/**
 * Only fields the server keeps: duration is stored for distance exercises only, so a duration from
 * RepCounter on push-ups and the like is not queued. Otherwise the server's answer (`null`) would
 * differ from the payload (a needless follow-up PUT) and the Health record written at once would
 * carry another fingerprint than the server's record (a rewrite on every reconcile).
 */
function storedFields<T extends { exerciseType: string; durationSeconds?: number | null }>(payload: T): T {
  if (payload.durationSeconds == null || isDistanceExercise(payload.exerciseType)) return payload;
  const { durationSeconds: _dropped, ...rest } = payload;
  void _dropped;
  return rest as T;
}

export function createOutboxItem(userId: string, payload: NewOutboxPayload, now: Date): OutboxItem {
  const clientRequestId = payload.clientRequestId || newClientRequestId();
  return {
    id: clientRequestId,
    userId,
    payload: storedFields({ ...payload, clientRequestId }),
    createdAt: now.toISOString(),
    attempts: 0,
    status: 'pending',
    nextAttemptAt: null,
    lastError: null,
  };
}

function byRecordOrder(a: OutboxItem, b: OutboxItem): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Not finished sending (another flush or tab owns it and its lease is still running). */
export function isInFlight(item: OutboxItem, now: Date): boolean {
  return item.status === 'sending' && item.nextAttemptAt !== null && new Date(item.nextAttemptAt).getTime() > now.getTime();
}

/**
 * The item to send now: the oldest one that is not rejected. Order is strict — when the oldest
 * is still in its pause or being sent, nothing goes, so the server gets the records in the order
 * they were made. `ignoreBackoff` (network back, app resumed, sign-in) skips a retry pause, never a lease.
 */
export function nextSendable(items: OutboxItem[], now: Date, opts: { ignoreBackoff?: boolean } = {}): OutboxItem | null {
  const head = items.filter((item) => item.status !== 'rejected').sort(byRecordOrder)[0];
  if (!head) return null;
  if (head.status === 'sending') return isInFlight(head, now) ? null : head;
  if (!opts.ignoreBackoff && head.nextAttemptAt && new Date(head.nextAttemptAt).getTime() > now.getTime()) return null;
  return head;
}

/** The item while a sender owns it. */
export function markSending(item: OutboxItem, now: Date): OutboxItem {
  return { ...item, status: 'sending', nextAttemptAt: plusSeconds(now, SENDING_LEASE_SECONDS) };
}

/**
 * The stored item is still the one `leased` to this sender (same lease): only then may the sender
 * write its result. Otherwise the lease ran out and the item was edited, deleted or taken by
 * another sender meanwhile — that newer state wins.
 */
export function holdsLease(current: OutboxItem | null, leased: OutboxItem): boolean {
  return Boolean(current) && current!.id === leased.id && current!.status === 'sending' && current!.nextAttemptAt === leased.nextAttemptAt;
}

/** 5, 15, 60, 300, then 900 seconds after the 1st, 2nd, … failed attempt. */
export function backoffSeconds(attempts: number): number {
  const index = Math.min(Math.max(Math.trunc(attempts), 1), BACKOFF_STEPS_SECONDS.length) - 1;
  return BACKOFF_STEPS_SECONDS[index];
}

/** What happens to the item after the server's answer; `item: null` — remove it. */
export function applyOutcome(
  item: OutboxItem,
  outcome: SendOutcome,
  now: Date,
): { item: OutboxItem | null; pauseUntil?: string; stop?: 'unauthorized' } {
  switch (outcome.kind) {
    case 'created':
    case 'replayed':
      return { item: null };
    case 'rejected':
      return { item: { ...item, status: 'rejected', attempts: item.attempts + 1, nextAttemptAt: null, lastError: outcome.message } };
    case 'rate-limited': {
      const pauseUntil = plusSeconds(now, Math.max(1, outcome.retryAfterSeconds));
      return { item: { ...item, status: 'pending', nextAttemptAt: pauseUntil }, pauseUntil };
    }
    case 'unauthorized':
      return { item: { ...item, status: 'pending', nextAttemptAt: null }, stop: 'unauthorized' };
    case 'retry': {
      const attempts = item.attempts + 1;
      return {
        item: { ...item, status: 'pending', attempts, nextAttemptAt: plusSeconds(now, backoffSeconds(attempts)), lastError: outcome.reason },
      };
    }
  }
}

/**
 * The item after the user edited it before it was sent: new values, same `clientRequestId`,
 * sent again from scratch. `null` while it is being sent — it may already be on the server.
 */
export function editOutboxItem(item: OutboxItem, patch: OutboxPayloadPatch, now: Date): OutboxItem | null {
  if (isInFlight(item, now)) return null;
  return {
    ...item,
    payload: storedFields({ ...item.payload, ...patch, clientRequestId: item.payload.clientRequestId }),
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
  };
}

type ServerWorkoutLike = { id?: unknown; reps?: unknown; exerciseType?: unknown; date?: unknown; time?: unknown; loadKg?: unknown; durationSeconds?: unknown };

function sameNumber(a: unknown, b: unknown): boolean {
  const left = a == null ? null : Number(a);
  const right = b == null ? null : Number(b);
  return left === right;
}

/**
 * The server answered with a record that differs from the payload: an earlier attempt with this
 * `clientRequestId` reached the server before the user edited the item, so the server replayed the
 * old values. The edit must then be applied to that record.
 */
export function needsFollowUpEdit(payload: OutboxPayload, workout: ServerWorkoutLike): boolean {
  if (!sameNumber(workout.reps, payload.reps)) return true;
  if (typeof workout.exerciseType === 'string' && workout.exerciseType !== payload.exerciseType) return true;
  if (typeof workout.date === 'string' && workout.date.slice(0, 10) !== payload.date) return true;
  if (typeof workout.time === 'string' && new Date(workout.time).getTime() !== new Date(payload.time).getTime()) return true;
  if (workout.loadKg !== undefined && !sameNumber(workout.loadKg, payload.loadKg)) return true;
  // Duration exists only for distance exercises (the server answers null for the rest).
  const exerciseType = typeof workout.exerciseType === 'string' ? workout.exerciseType : payload.exerciseType;
  if (isDistanceExercise(exerciseType) && workout.durationSeconds !== undefined && !sameNumber(workout.durationSeconds, payload.durationSeconds)) return true;
  return false;
}

/** Points of not yet sent (and not rejected) items of `day` — through `calculateExercisePoints`. */
export function pendingPoints(items: OutboxItem[], day: DayKey): number {
  let tenths = 0;
  for (const item of items) {
    if (item.status === 'rejected' || item.payload.date !== day) continue;
    tenths += pointsToTenths(calculateExercisePoints(item.payload.reps, item.payload.exerciseType, item.payload.loadKg ?? null));
  }
  return tenthsToPoints(tenths);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseRetryAfter(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_SECONDS;
  const seconds = Number(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds);
  return DEFAULT_RETRY_AFTER_SECONDS;
}

/** The send outcome for an HTTP answer of `POST /api/workouts`. */
export function classifyResponse(status: number, body: unknown, retryAfter: string | null): SendOutcome {
  if (status >= 200 && status < 300) {
    const workout = isObject(body) && isObject(body.workout) ? body.workout : null;
    const workoutId = workout && (typeof workout.id === 'string' || typeof workout.id === 'number') ? String(workout.id) : '';
    // Without the record's id there is no proof it exists: resend, the same id cannot duplicate it.
    if (!workoutId) return { kind: 'retry', reason: `HTTP ${status}` };
    return { kind: 'created', workoutId, response: body };
  }
  if (status === 401) return { kind: 'unauthorized' };
  if (status === 429) return { kind: 'rate-limited', retryAfterSeconds: parseRetryAfter(retryAfter) };
  if (status === 408 || status >= 500) return { kind: 'retry', reason: `HTTP ${status}` };
  const base = isObject(body) && typeof body.error === 'string' && body.error ? body.error : `HTTP ${status}`;
  const details = isObject(body) && typeof body.details === 'string' ? body.details : '';
  return { kind: 'rejected', status, message: details ? `${base}: ${details}` : base };
}

/** JSON body of `POST /api/workouts`: empty optional fields are left out. */
export function toRequestBody(payload: OutboxPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (value !== null && value !== undefined && value !== '') body[key] = value;
  }
  return body;
}

/**
 * Day and instant of a new entry from the form. An untouched day is today in the user's zone at
 * the moment of saving (a page left open over midnight does not stamp yesterday); an untouched time
 * is that moment; a chosen time is read on the user's wall clock of the chosen day.
 */
export function resolveEntryMoment(
  input: { date: DayKey; time: string; dateTouched: boolean; timeTouched: boolean },
  now: Date,
  timeZone: string,
): { date: DayKey; time: string } {
  const today = dayKeyInZone(now, timeZone);
  const date = input.dateTouched ? input.date : today;
  if (input.timeTouched) return { date, time: zonedTimeToInstant(date, input.time, timeZone).toISOString() };
  if (date === today) return { date, time: now.toISOString() };
  return { date, time: zonedTimeToInstant(date, localHHMM(now, timeZone), timeZone).toISOString() };
}
