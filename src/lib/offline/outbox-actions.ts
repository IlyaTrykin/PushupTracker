/**
 * Edit and delete of a queued workout (used by `useOutbox`), outside React so the races with the
 * sender can be tested. The native background copy is taken back first (`cancelBackground`); the
 * write itself checks, in the same storage transaction, that the item is still waiting — an item the
 * sender took meanwhile (it may already be on the server) is refused with `OutboxBusyError`.
 *
 * Delete of an entry that may already be on the server (a request went out, or the native copy did)
 * does not just forget it: the entry becomes «будет удалена» and the sender deletes it on the server
 * by its `clientRequestId` (`planQueuedRemoval`).
 */

import { cancelBackground, type CancelResult } from './background-upload';
import { editOutboxItem, isInFlight, markForServerDelete, planQueuedRemoval, type OutboxItem, type OutboxPayloadPatch } from './outbox-core';
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

/**
 * `'removed'` — the entry never left the device and is gone; `'deleting'` — it may be on the server
 * and stays as «будет удалена» until the server confirms. Throws `OutboxBusyError` while the item is
 * being sent or when the sender took it to the server meanwhile.
 */
export async function removeQueuedItem(userId: string, id: string, deps: OutboxActionDeps = {}): Promise<'removed' | 'deleting'> {
  const now = deps.now ?? (() => new Date());
  const current = await findItem(userId, id);
  if (!current) return 'removed';
  if (current.deleteOnServer) return 'deleting';
  if (isInFlight(current, now())) throw new OutboxBusyError();
  const background = await (deps.cancelBackground ?? cancelBackground)(id);
  // Decided on what is stored now: gone meanwhile means the sender took it to the server (the
  // dashboard then shows the server record); in flight — refused, it may be there already.
  const outcome = await outboxStore.change<'removed' | 'deleting' | null>(id, (latest) => {
    if (!latest || isInFlight(latest, now())) return { result: null };
    return planQueuedRemoval(latest, background) === 'drop'
      ? { next: null, result: 'removed' }
      : { next: markForServerDelete(latest), result: 'deleting' };
  });
  if (!outcome) throw new OutboxBusyError();
  return outcome;
}
