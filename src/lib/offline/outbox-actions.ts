/**
 * Edit and delete of a queued workout (used by `useOutbox`), outside React so the races with the
 * sender can be tested. The native background copy is taken back first (`cancelBackground`); the
 * write itself checks, in the same storage transaction, that the item is still waiting — an item the
 * sender took meanwhile (it may already be on the server) is refused with `OutboxBusyError`.
 */

import { cancelBackground, type CancelResult } from './background-upload';
import { editOutboxItem, isInFlight, type OutboxItem, type OutboxPayloadPatch } from './outbox-core';
import { outboxStore } from './outbox-store';
import { flushOutbox } from './sync';

/** The item is being sent right now and cannot be changed (it may already be on the server). */
export class OutboxBusyError extends Error {
  constructor() {
    super('outbox item is being sent');
    this.name = 'OutboxBusyError';
  }
}

/** The native background sender already took the item to the server: change it after the sync. */
export class OutboxAlreadySentError extends OutboxBusyError {
  constructor() {
    super();
    this.message = 'outbox item was already sent in the background';
    this.name = 'OutboxAlreadySentError';
  }
}

export type OutboxActionDeps = {
  cancelBackground?(id: string): Promise<CancelResult>;
  now?(): Date;
};

/** The refusal; the JS sender then fetches the server's record (replay), so the entry soon becomes editable there. */
function alreadySent(userId: string): OutboxAlreadySentError {
  void flushOutbox(userId, { ignoreBackoff: true });
  return new OutboxAlreadySentError();
}

async function findItem(userId: string, id: string): Promise<OutboxItem | null> {
  return (await outboxStore.list(userId)).find((item) => item.id === id) ?? null;
}

/** Throws `OutboxBusyError` while the item is being sent or once it has left the queue. */
export async function updateQueuedItem(userId: string, id: string, patch: OutboxPayloadPatch, deps: OutboxActionDeps = {}): Promise<OutboxItem> {
  const now = deps.now ?? (() => new Date());
  const current = await findItem(userId, id);
  if (!current) throw new OutboxBusyError(); // already sent and removed
  if (isInFlight(current, now())) throw new OutboxBusyError();
  // The background copy carries the old values: take it back first, or refuse.
  if ((await (deps.cancelBackground ?? cancelBackground)(id)) === 'sent') throw alreadySent(userId);
  // Written from what is stored now, in the transaction that checks it: the sender may have taken
  // the item (in flight) or sent it (gone) while the native copy was being taken back.
  const edited = await outboxStore.change(id, (latest) => {
    const next = latest ? editOutboxItem(latest, patch, now()) : null;
    return next ? { next, result: next } : { result: null };
  });
  if (!edited) throw new OutboxBusyError();
  return edited;
}

/** Throws `OutboxBusyError` while the item is being sent or when it went to the server meanwhile. */
export async function removeQueuedItem(userId: string, id: string, deps: OutboxActionDeps = {}): Promise<void> {
  const now = deps.now ?? (() => new Date());
  const current = await findItem(userId, id);
  if (!current) return;
  if (isInFlight(current, now())) throw new OutboxBusyError();
  if ((await (deps.cancelBackground ?? cancelBackground)(id)) === 'sent') throw alreadySent(userId);
  // Gone meanwhile means the sender took it to the server; in flight — it may be there already.
  const removed = await outboxStore.change(id, (latest) =>
    latest && !isInFlight(latest, now()) ? { next: null, result: true } : { result: false },
  );
  if (!removed) throw new OutboxBusyError();
}
