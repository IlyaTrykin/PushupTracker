'use client';

/**
 * The outbox of the signed-in user for React.
 * - `useOutbox()` — items, enqueue/edit/remove and sending on demand (screens that show the queue);
 * - `useOutboxSync()` — the sender, mounted once in the common navigation, so the queue goes out
 *   from any screen: on start and sign-in, when the network comes back (`online`, in the app also
 *   `@capacitor/network`), when the page or app becomes visible again (`visibilitychange`, in the
 *   app also `@capacitor/app` resume), and every 60 s while something waits.
 *
 * In the app every queued item is also handed to the native background sender
 * (`./background-upload`); an edit or delete first takes it back from there.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { isNativeApp } from '@/lib/platform';
import { dropBackground, mirrorToBackground, reconcileBackground } from './background-upload';
import { removeQueuedItem, updateQueuedItem } from './outbox-actions';
import { createOutboxItem, type NewOutboxPayload, type OutboxItem, type OutboxPayloadPatch } from './outbox-core';
import { OUTBOX_CHANGED_EVENT, outboxStore } from './outbox-store';
import { OUTBOX_FLUSHED_EVENT, OUTBOX_ITEM_SENT_EVENT, flushOutbox, type FlushResult, type OutboxItemSentDetail } from './sync';

const RETRY_TIMER_MS = 60_000;
const NO_USER_RESULT: FlushResult = { sent: 0, rejected: 0 };
const NO_ITEMS: OutboxItem[] = [];

export { OutboxAlreadySentError, OutboxBusyError } from './outbox-actions';

export type UseOutbox = {
  items: OutboxItem[];
  /** Waiting or being sent (not rejected). */
  pendingCount: number;
  rejectedCount: number;
  enqueue(p: NewOutboxPayload): Promise<OutboxItem>;
  /** Throws `OutboxBusyError` while the item is being sent (`OutboxAlreadySentError` — sent in the background). */
  update(id: string, patch: OutboxPayloadPatch): Promise<void>;
  /** Throws `OutboxBusyError` while the item is being sent (`OutboxAlreadySentError` — sent in the background). */
  remove(id: string): Promise<void>;
  flush(opts?: { ignoreBackoff?: boolean }): Promise<FlushResult>;
};

/** Items of `userId`, re-read after every change of the queue (any hook, flush or tab). */
function useOutboxItems(userId: string | null): OutboxItem[] {
  // Items are kept with their owner: after sign-out or a switch of account the old list is not shown.
  const [loaded, setLoaded] = useState<{ userId: string; items: OutboxItem[] } | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = () => {
      outboxStore
        .list(userId)
        .then((list) => {
          if (!cancelled) setLoaded({ userId, items: list });
        })
        .catch((error: unknown) => console.error('outbox: cannot read the queue', error));
    };
    const onChanged = (event: Event) => {
      const changedUser = (event as CustomEvent<{ userId?: string }>).detail?.userId;
      if (!changedUser || changedUser === userId) load();
    };
    load();
    window.addEventListener(OUTBOX_CHANGED_EVENT, onChanged);
    return () => {
      cancelled = true;
      window.removeEventListener(OUTBOX_CHANGED_EVENT, onChanged);
    };
  }, [userId]);

  return loaded && loaded.userId === userId ? loaded.items : NO_ITEMS;
}

function countPending(items: OutboxItem[]): number {
  return items.filter((item) => item.status !== 'rejected').length;
}

/**
 * The sender of the signed-in user's queue. Mount once, in the navigation shared by all screens.
 */
export function useOutboxSync(): void {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const items = useOutboxItems(userId);
  const pendingCount = useMemo(() => countPending(items), [items]);

  // Start / sign-in (userId appears), network back, page or app visible again.
  useEffect(() => {
    if (!userId) return;
    const kick = () => void flushOutbox(userId, { ignoreBackoff: true });
    const onVisible = () => {
      if (document.visibilityState === 'visible') kick();
    };
    kick();
    window.addEventListener('online', kick);
    window.addEventListener('authChanged', kick);
    document.addEventListener('visibilitychange', onVisible);

    // App: @capacitor/network and @capacitor/app resume (WebView events alone are not reliable).
    let disposed = false;
    const nativeHandles: Array<{ remove(): Promise<void> }> = [];
    const keep = (handle: { remove(): Promise<void> }) => {
      if (disposed) void handle.remove().catch(() => undefined);
      else nativeHandles.push(handle);
    };
    if (isNativeApp()) {
      void import('@capacitor/network')
        .then(({ Network }) => Network.addListener('networkStatusChange', (status) => status.connected && kick()))
        .then(keep)
        .catch(() => undefined);
      void import('@capacitor/app')
        .then(({ App }) => App.addListener('resume', kick))
        .then(keep)
        .catch(() => undefined);
    }
    return () => {
      disposed = true;
      window.removeEventListener('online', kick);
      window.removeEventListener('authChanged', kick);
      document.removeEventListener('visibilitychange', onVisible);
      for (const handle of nativeHandles.splice(0)) void handle.remove().catch(() => undefined);
    };
  }, [userId]);

  // Every minute while something waits (respects retry pauses).
  useEffect(() => {
    if (!userId || pendingCount === 0) return;
    const timer = window.setInterval(() => void flushOutbox(userId), RETRY_TIMER_MS);
    return () => window.clearInterval(timer);
  }, [pendingCount, userId]);

  // App: the server answered the JS sender — the native copy is not needed any more.
  // On start and after each flush the native queue is brought in line with the outbox.
  useEffect(() => {
    if (!userId || !isNativeApp()) return;
    const onSent = (event: Event) => {
      const detail = (event as CustomEvent<OutboxItemSentDetail>).detail;
      if (detail?.userId !== userId) return;
      const kind = detail.outcome.kind;
      if (kind === 'created' || kind === 'replayed' || kind === 'rejected') void dropBackground(detail.id);
    };
    const reconcile = () => {
      void outboxStore
        .list(userId)
        .then((list) => reconcileBackground(list))
        .catch((error: unknown) => console.error('outbox: background reconcile failed', error));
    };
    reconcile();
    window.addEventListener(OUTBOX_ITEM_SENT_EVENT, onSent);
    window.addEventListener(OUTBOX_FLUSHED_EVENT, reconcile);
    return () => {
      window.removeEventListener(OUTBOX_ITEM_SENT_EVENT, onSent);
      window.removeEventListener(OUTBOX_FLUSHED_EVENT, reconcile);
    };
  }, [userId]);
}

export function useOutbox(): UseOutbox {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const items = useOutboxItems(userId);
  const pendingCount = useMemo(() => countPending(items), [items]);
  const rejectedCount = items.length - pendingCount;

  const enqueue = useCallback(
    async (p: NewOutboxPayload) => {
      if (!userId) throw new Error('outbox: no signed-in user');
      const item = createOutboxItem(userId, p, new Date());
      await outboxStore.put(item);
      await mirrorToBackground(item);
      return item;
    },
    [userId],
  );

  const update = useCallback(
    async (id: string, patch: OutboxPayloadPatch) => {
      if (!userId) throw new Error('outbox: no signed-in user');
      const edited = await updateQueuedItem(userId, id, patch);
      await mirrorToBackground(edited);
    },
    [userId],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!userId) return;
      await removeQueuedItem(userId, id);
    },
    [userId],
  );

  const flush = useCallback(
    async (opts?: { ignoreBackoff?: boolean }) =>
      userId ? flushOutbox(userId, { ignoreBackoff: opts?.ignoreBackoff ?? true }) : NO_USER_RESULT,
    [userId],
  );

  return { items, pendingCount, rejectedCount, enqueue, update, remove, flush };
}
