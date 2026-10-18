/**
 * Native background sending of the outbox (app only; on the site everything here is a no-op).
 *
 * Every queued workout is also handed to the `BackgroundUpload` plugin — iOS: a background
 * `URLSession`, Android: WorkManager with a «network connected» constraint — so it reaches the
 * server even when the app is closed before the connection comes back. Both senders use the same
 * `clientRequestId`, so the second one only gets the server's replay, never a duplicate.
 *
 * The native upload starts no earlier than `NATIVE_START_DELAY_SECONDS` after it was queued: while
 * the app is open the JS sender goes first (its answer carries the reward and records) and then
 * cancels the native copy.
 *
 * Edit/delete of a queued item first cancels its native copy; when that is no longer possible
 * (being sent or already on the server) the change is refused — `'sent'` from `cancelBackground`.
 *
 * Ids handed to the plugin are remembered in localStorage: a missing native record of a mirrored
 * id means «already sent» (the platform forgets finished work), not «never queued».
 */

import { registerPlugin } from '@capacitor/core';
import { currentToken } from '@/lib/native-auth';
import { rewriteRequest } from '@/lib/native-fetch';
import { apiBase, isNativeApp } from '@/lib/platform';
import { toRequestBody, type OutboxItem } from './outbox-core';

export type BackgroundUploadState = 'queued' | 'running' | 'done' | 'failed';
export type BackgroundUploadRecord = { id: string; state: BackgroundUploadState; httpStatus?: number };
/** `cancelled` — the native copy is gone; `none` — there was nothing to cancel; `sent` — too late. */
export type CancelResult = 'cancelled' | 'none' | 'sent';

type BackgroundUploadPlugin = {
  enqueue(options: { id: string; url: string; headers: Record<string, string>; body: string; delaySeconds?: number }): Promise<{ queued: boolean }>;
  cancel(options: { id: string }): Promise<{ cancelled: boolean }>;
  list(): Promise<{ items: BackgroundUploadRecord[] }>;
};

/** The JS sender gets this head start while the app is open. */
export const NATIVE_START_DELAY_SECONDS = 30;
const MIRRORED_KEY = 'pushup-bg-upload:v1';
const WORKOUTS_PATH = '/api/workouts';

let plugin: BackgroundUploadPlugin | null = null;
let appVersionPromise: Promise<string> | null = null;

function backgroundUpload(): BackgroundUploadPlugin {
  if (!plugin) plugin = registerPlugin<BackgroundUploadPlugin>('BackgroundUpload');
  return plugin;
}

function appVersion(): Promise<string> {
  if (!appVersionPromise) {
    appVersionPromise = import('@capacitor/app')
      .then(({ App }) => App.getInfo())
      .then((info) => (info.version ? (info.build ? `${info.version}+${info.build}` : info.version) : ''))
      .catch(() => process.env.NEXT_PUBLIC_BUILD_VERSION || '');
  }
  return appVersionPromise;
}

function readMirrored(): Set<string> {
  try {
    const raw = window.localStorage.getItem(MIRRORED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

function writeMirrored(ids: Set<string>) {
  try {
    if (ids.size) window.localStorage.setItem(MIRRORED_KEY, JSON.stringify(Array.from(ids)));
    else window.localStorage.removeItem(MIRRORED_KEY);
  } catch {}
}

function updateMirrored(change: (ids: Set<string>) => void) {
  const ids = readMirrored();
  change(ids);
  writeMirrored(ids);
}

/** The request the native side sends: same URL, headers (Bearer, X-Client: native, …) and body as the JS sender. */
export function buildBackgroundRequest(
  item: OutboxItem,
  ctx: { apiBase: string; token: string | null; appVersion: string; locale: string },
): { url: string; headers: Record<string, string>; body: string } | null {
  if (!ctx.apiBase || !ctx.token) return null;
  const body = JSON.stringify(toRequestBody(item.payload));
  const { url, init, isApi } = rewriteRequest(WORKOUTS_PATH, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }, ctx);
  if (!isApi) return null;
  return { url, headers: (init.headers ?? {}) as Record<string, string>, body };
}

/**
 * What a cancel answer means. A mirrored id the plugin could not cancel is on the server or on its
 * way there; an id that was never mirrored has nothing to cancel.
 */
export function cancelVerdict(wasMirrored: boolean, nativeCancelled: boolean): CancelResult {
  if (nativeCancelled) return 'cancelled';
  return wasMirrored ? 'sent' : 'none';
}

/**
 * Bringing the native queue in line with the outbox (app start, after a flush):
 * - `mirror` — waiting items without a live native copy (never handed over, or failed — e.g. 401
 *   with an old token): hand them over again with the current headers;
 * - `cancel` — finished or failed native records whose item left the outbox (sent by JS, deleted);
 * - `forget` — mirrored ids neither in the outbox nor in the native queue.
 */
export function planBackgroundReconcile(
  items: OutboxItem[],
  native: BackgroundUploadRecord[],
  mirrored: ReadonlySet<string>,
): { mirror: string[]; cancel: string[]; forget: string[] } {
  const inOutbox = new Set(items.map((item) => item.id));
  const byId = new Map(native.map((record) => [record.id, record]));
  const mirror: string[] = [];
  for (const item of items) {
    // A tombstone («будет удалена») is deleted on the server by the JS sender, never sent again.
    if (item.status === 'rejected' || item.deleteOnServer) continue;
    const record = byId.get(item.id);
    if (record ? record.state === 'failed' : !mirrored.has(item.id)) mirror.push(item.id);
  }
  const cancel = native.filter((record) => !inOutbox.has(record.id) && (record.state === 'done' || record.state === 'failed')).map((record) => record.id);
  const forget = Array.from(mirrored).filter((id) => !inOutbox.has(id) && (!byId.has(id) || cancel.includes(id)));
  return { mirror, cancel, forget };
}

/** Hands the item to the native background sender. False on the site, without a token or on failure. */
export async function mirrorToBackground(item: OutboxItem): Promise<boolean> {
  if (!isNativeApp() || item.status === 'rejected' || item.deleteOnServer) return false;
  try {
    const request = buildBackgroundRequest(item, {
      apiBase: apiBase(),
      token: currentToken(),
      appVersion: await appVersion(),
      locale: (typeof document !== 'undefined' && document.documentElement.lang) || '',
    });
    if (!request) return false;
    const { queued } = await backgroundUpload().enqueue({ id: item.id, ...request, delaySeconds: NATIVE_START_DELAY_SECONDS });
    if (queued) updateMirrored((ids) => ids.add(item.id));
    return queued;
  } catch (error) {
    console.error('background upload: cannot queue', error);
    return false;
  }
}

/** Cancels the native copy before the item is edited or deleted. `'sent'` — refuse the change. */
export async function cancelBackground(id: string): Promise<CancelResult> {
  if (!isNativeApp()) return 'none';
  const wasMirrored = readMirrored().has(id);
  let cancelled = false;
  try {
    ({ cancelled } = await backgroundUpload().cancel({ id }));
  } catch (error) {
    // Unknown fate of a handed-over copy: it may be on the server.
    console.error('background upload: cannot cancel', error);
    return cancelVerdict(wasMirrored, false);
  }
  const verdict = cancelVerdict(wasMirrored, cancelled);
  if (verdict === 'cancelled') updateMirrored((ids) => ids.delete(id));
  return verdict;
}

/**
 * The native copy of `id` is still queued or being sent: a delete by `clientRequestId` must wait,
 * or the copy would land after it and re-create the workout. False on the site or when unknown.
 */
export async function isBackgroundUploadActive(id: string): Promise<boolean> {
  if (!isNativeApp()) return false;
  try {
    const { items } = await backgroundUpload().list();
    return items.some((record) => record.id === id && (record.state === 'queued' || record.state === 'running'));
  } catch {
    return false;
  }
}

/** After the JS sender got the server's answer: the native copy is no longer needed. */
export async function dropBackground(id: string): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await backgroundUpload().cancel({ id });
  } catch {}
  updateMirrored((ids) => ids.delete(id));
}

/** Sign-out with «sign out and delete»: nothing of this device's queue may still go out. */
export async function cancelAllBackground(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    const { items } = await backgroundUpload().list();
    await Promise.all(items.map((record) => backgroundUpload().cancel({ id: record.id }).catch(() => undefined)));
  } catch (error) {
    console.error('background upload: cannot cancel all', error);
  }
  writeMirrored(new Set());
}

/** See `planBackgroundReconcile`. */
export async function reconcileBackground(items: OutboxItem[]): Promise<void> {
  if (!isNativeApp()) return;
  let native: BackgroundUploadRecord[];
  try {
    native = (await backgroundUpload().list()).items;
  } catch (error) {
    console.error('background upload: cannot list', error);
    return;
  }
  const plan = planBackgroundReconcile(items, native, readMirrored());
  for (const id of plan.cancel) await backgroundUpload().cancel({ id }).catch(() => undefined);
  if (plan.forget.length) updateMirrored((ids) => plan.forget.forEach((id) => ids.delete(id)));
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const id of plan.mirror) {
    const item = byId.get(id);
    if (item) await mirrorToBackground(item);
  }
}
