'use client';

/**
 * The outbox of the signed-in user for React: items, enqueue/edit/remove and sending.
 * While mounted it sends on start and sign-in, when the network comes back, when the page or app
 * becomes visible again, and every 60 s while something waits.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { createOutboxItem, editOutboxItem, isInFlight, type NewOutboxPayload, type OutboxItem, type OutboxPayloadPatch } from './outbox-core';
import { OUTBOX_CHANGED_EVENT, outboxStore } from './outbox-store';
import { flushOutbox, type FlushResult } from './sync';

const RETRY_TIMER_MS = 60_000;
const NO_USER_RESULT: FlushResult = { sent: 0, rejected: 0 };
const NO_ITEMS: OutboxItem[] = [];

/** The item is being sent right now and cannot be changed (it may already be on the server). */
export class OutboxBusyError extends Error {
  constructor() {
    super('outbox item is being sent');
    this.name = 'OutboxBusyError';
  }
}

export type UseOutbox = {
  items: OutboxItem[];
  /** Waiting or being sent (not rejected). */
  pendingCount: number;
  rejectedCount: number;
  enqueue(p: NewOutboxPayload): Promise<OutboxItem>;
  /** Throws `OutboxBusyError` while the item is being sent. */
  update(id: string, patch: OutboxPayloadPatch): Promise<void>;
  /** Throws `OutboxBusyError` while the item is being sent. */
  remove(id: string): Promise<void>;
  flush(opts?: { ignoreBackoff?: boolean }): Promise<FlushResult>;
};

export function useOutbox(): UseOutbox {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Items are kept with their owner: after sign-out or a switch of account the old list is not shown.
  const [loaded, setLoaded] = useState<{ userId: string; items: OutboxItem[] } | null>(null);
  const items = loaded && loaded.userId === userId ? loaded.items : NO_ITEMS;

  // Read the queue on mount and after every change (this tab's flush, edits, other hooks).
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
    return () => {
      window.removeEventListener('online', kick);
      window.removeEventListener('authChanged', kick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [userId]);

  const pendingCount = useMemo(() => items.filter((item) => item.status !== 'rejected').length, [items]);
  const rejectedCount = items.length - pendingCount;

  // Every minute while something waits (respects retry pauses).
  useEffect(() => {
    if (!userId || pendingCount === 0) return;
    const timer = window.setInterval(() => void flushOutbox(userId), RETRY_TIMER_MS);
    return () => window.clearInterval(timer);
  }, [pendingCount, userId]);

  const enqueue = useCallback(
    async (p: NewOutboxPayload) => {
      if (!userId) throw new Error('outbox: no signed-in user');
      const item = createOutboxItem(userId, p, new Date());
      await outboxStore.put(item);
      return item;
    },
    [userId],
  );

  const findItem = useCallback(
    async (id: string) => {
      if (!userId) return null;
      return (await outboxStore.list(userId)).find((item) => item.id === id) ?? null;
    },
    [userId],
  );

  const update = useCallback(
    async (id: string, patch: OutboxPayloadPatch) => {
      const current = await findItem(id);
      if (!current) throw new OutboxBusyError(); // already sent and removed
      const edited = editOutboxItem(current, patch, new Date());
      if (!edited) throw new OutboxBusyError();
      await outboxStore.put(edited);
    },
    [findItem],
  );

  const remove = useCallback(
    async (id: string) => {
      const current = await findItem(id);
      if (!current) return;
      if (isInFlight(current, new Date())) throw new OutboxBusyError();
      await outboxStore.remove(id);
    },
    [findItem],
  );

  const flush = useCallback(
    async (opts?: { ignoreBackoff?: boolean }) =>
      userId ? flushOutbox(userId, { ignoreBackoff: opts?.ignoreBackoff ?? true }) : NO_USER_RESULT,
    [userId],
  );

  return { items, pendingCount, rejectedCount, enqueue, update, remove, flush };
}
