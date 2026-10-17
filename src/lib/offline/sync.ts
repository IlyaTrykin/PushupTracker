/**
 * Sending the outbox: one item at a time in record order, each with its own `clientRequestId`.
 * Stops on the first network failure (offline), on 401 (wait for sign-in) and on 429
 * (paused until Retry-After, the pause survives reloads).
 *
 * Window events: 'outboxItemSent' {userId, id, outcome} after every answer from the server,
 * 'outboxFlushed' {userId, sent, rejected, stopped} after a flush that sent something.
 */

import {
  applyOutcome,
  classifyResponse,
  markSending,
  needsFollowUpEdit,
  nextSendable,
  toRequestBody,
  type OutboxItem,
  type OutboxPayload,
  type SendOutcome,
} from './outbox-core';
import { outboxStore } from './outbox-store';

export type FlushResult = { sent: number; rejected: number; stopped?: 'unauthorized' | 'rate-limited' | 'offline' };
export type FlushDeps = {
  send?(p: OutboxPayload): Promise<SendOutcome>;
  now?(): Date;
  /** Skip retry pauses (network is back, app resumed, signed in, the user just saved). Never skips a 429 pause. */
  ignoreBackoff?: boolean;
};
export type OutboxItemSentDetail = { userId: string; id: string; outcome: SendOutcome; item: OutboxItem | null };
export type OutboxFlushedDetail = FlushResult & { userId: string };

export const OUTBOX_ITEM_SENT_EVENT = 'outboxItemSent';
export const OUTBOX_FLUSHED_EVENT = 'outboxFlushed';

const SEND_TIMEOUT_MS = 20_000;
const MAX_ITEMS_PER_FLUSH = 500;
const PAUSE_KEY_PREFIX = 'pushup-outbox-pause:v1:';

function readPause(userId: string): number {
  try {
    const raw = window.localStorage.getItem(PAUSE_KEY_PREFIX + userId);
    const until = raw ? new Date(raw).getTime() : 0;
    return Number.isFinite(until) ? until : 0;
  } catch {
    return 0;
  }
}

function writePause(userId: string, until: string | null) {
  try {
    if (until) window.localStorage.setItem(PAUSE_KEY_PREFIX + userId, until);
    else window.localStorage.removeItem(PAUSE_KEY_PREFIX + userId);
  } catch {}
}

/** Until when the queue of `userId` waits after a 429, or null. */
export function outboxPausedUntil(userId: string, now: Date = new Date()): Date | null {
  const until = readPause(userId);
  return until > now.getTime() ? new Date(until) : null;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function emit<T>(name: string, detail: T) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<T>(name, { detail }));
}

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** POST /api/workouts with the item's `clientRequestId`. Never throws. */
export async function sendWorkout(p: OutboxPayload): Promise<SendOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const res = await fetch('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toRequestBody(p)),
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = await readJson(res);
    const outcome = classifyResponse(res.status, data, res.headers.get('Retry-After'));
    if (outcome.kind !== 'created') return outcome;

    const workout = (data as { workout?: Record<string, unknown> }).workout ?? {};
    if (!needsFollowUpEdit(p, workout)) return outcome;
    // An earlier attempt reached the server before the user edited the item: apply the edit.
    const { clientRequestId: _id, trainingSessionId: _session, ...fields } = toRequestBody(p);
    void _id;
    void _session;
    const put = await fetch('/api/workouts', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: outcome.workoutId, ...fields }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (put.ok) return outcome;
    const putOutcome = classifyResponse(put.status, await readJson(put), put.headers.get('Retry-After'));
    return putOutcome.kind === 'created' ? outcome : putOutcome;
  } catch (error: unknown) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    return { kind: 'retry', reason: aborted ? 'timeout' : 'network' };
  } finally {
    clearTimeout(timer);
  }
}

async function runFlush(userId: string, deps: FlushDeps): Promise<FlushResult> {
  const send = deps.send ?? sendWorkout;
  const now = deps.now ?? (() => new Date());
  const result: FlushResult = { sent: 0, rejected: 0 };

  if (readPause(userId) > now().getTime()) return { ...result, stopped: 'rate-limited' };

  for (let i = 0; i < MAX_ITEMS_PER_FLUSH; i += 1) {
    const items = await outboxStore.list(userId);
    const item = nextSendable(items, now(), { ignoreBackoff: deps.ignoreBackoff });
    if (!item) break;
    if (isOffline()) {
      result.stopped = 'offline';
      break;
    }

    await outboxStore.put(markSending(item, now()));
    const outcome = await send(item.payload);
    const applied = applyOutcome(item, outcome, now());
    if (applied.item) await outboxStore.put(applied.item);
    else await outboxStore.remove(item.id);
    if (applied.pauseUntil) writePause(userId, applied.pauseUntil);
    emit<OutboxItemSentDetail>(OUTBOX_ITEM_SENT_EVENT, { userId, id: item.id, outcome, item: applied.item });

    if (outcome.kind === 'created' || outcome.kind === 'replayed') result.sent += 1;
    if (outcome.kind === 'rejected') result.rejected += 1;
    if (applied.stop === 'unauthorized') {
      result.stopped = 'unauthorized';
      break;
    }
    if (applied.pauseUntil) {
      result.stopped = 'rate-limited';
      break;
    }
    if (outcome.kind === 'retry') {
      result.stopped = 'offline';
      break;
    }
  }

  if (result.sent > 0) emit<OutboxFlushedDetail>(OUTBOX_FLUSHED_EVENT, { userId, ...result });
  return result;
}

let running: Promise<FlushResult> | null = null;
let queued: Promise<FlushResult> | null = null;
let queuedIgnoreBackoff = false;

/**
 * Sends what can be sent now. One flush at a time: a call during a running flush runs once more
 * after it (items added meanwhile are not left behind).
 */
export async function flushOutbox(userId: string, deps: FlushDeps = {}): Promise<FlushResult> {
  if (!running) {
    running = runFlush(userId, deps)
      .catch((error: unknown): FlushResult => {
        console.error('outbox flush failed', error);
        return { sent: 0, rejected: 0, stopped: 'offline' };
      })
      .finally(() => {
        running = null;
      });
    return running;
  }
  queuedIgnoreBackoff = queuedIgnoreBackoff || Boolean(deps.ignoreBackoff);
  if (!queued) {
    queued = running.then(() => {
      const ignoreBackoff = queuedIgnoreBackoff;
      queued = null;
      queuedIgnoreBackoff = false;
      return flushOutbox(userId, { ...deps, ignoreBackoff });
    });
  }
  return queued;
}
