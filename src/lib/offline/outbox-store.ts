/**
 * Device storage of the outbox: IndexedDB 'pushup-outbox', store 'items' (key `id`, index `userId`).
 * It survives reloads and app restarts; every change fires window 'outboxChanged'.
 * Without IndexedDB (rare private modes) items live in memory until the page closes.
 *
 * Check-then-write steps that race with the sender (another flush, another tab, an edit) run in one
 * readwrite transaction: `claimNext` (pick and lease the next item) and `change` (read one item and
 * decide what to write from what is stored now, not from an older snapshot).
 */

import { markSending, nextSendable, type OutboxItem } from './outbox-core';

/** What `change` writes: `undefined` — nothing, `null` — delete the item, an item — store it. */
export type OutboxChange<T> = { next?: OutboxItem | null; result: T };

const DB_NAME = 'pushup-outbox';
const DB_VERSION = 1;
const STORE = 'items';
const USER_INDEX = 'userId';

export const OUTBOX_CHANGED_EVENT = 'outboxChanged';

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memory = new Map<string, OutboxItem>();

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex(USER_INDEX, 'userId', { unique: false });
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrades the schema: let it, reopen on the next call.
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      request.onerror = () => {
        console.warn('outbox: IndexedDB unavailable, keeping the queue in memory', request.error);
        resolve(null);
      };
      request.onblocked = () => console.warn('outbox: IndexedDB open is blocked by another tab');
    } catch (error) {
      console.warn('outbox: IndexedDB unavailable, keeping the queue in memory', error);
      resolve(null);
    }
  });
  return dbPromise;
}

function notifyChanged(userId: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OUTBOX_CHANGED_EVENT, { detail: { userId } }));
}

async function listItems(userId: string): Promise<OutboxItem[]> {
  const db = await openDb();
  let items: OutboxItem[];
  if (!db) {
    items = Array.from(memory.values()).filter((item) => item.userId === userId);
  } else {
    const tx = db.transaction(STORE, 'readonly');
    items = await requestResult(tx.objectStore(STORE).index(USER_INDEX).getAll(userId) as IDBRequest<OutboxItem[]>);
  }
  return sortByRecordOrder(items);
}

async function putItem(item: OutboxItem): Promise<void> {
  const db = await openDb();
  if (!db) {
    memory.set(item.id, item);
  } else {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(item);
    await transactionDone(tx);
  }
  notifyChanged(item.userId);
}

async function removeItem(id: string): Promise<void> {
  const db = await openDb();
  let userId = '';
  if (!db) {
    userId = memory.get(id)?.userId ?? '';
    memory.delete(id);
  } else {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // Delete inside the request callback: the transaction stays active there in every engine.
    const lookup = store.get(id) as IDBRequest<OutboxItem | undefined>;
    lookup.onsuccess = () => {
      userId = lookup.result?.userId ?? '';
      store.delete(id);
    };
    await transactionDone(tx);
  }
  notifyChanged(userId);
}

function sortByRecordOrder(items: OutboxItem[]): OutboxItem[] {
  return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
}

/** The next item to send, leased to the caller (`status: 'sending'`) in the same transaction it was picked in. */
async function claimNext(userId: string, now: Date, opts: { ignoreBackoff?: boolean } = {}): Promise<OutboxItem | null> {
  const db = await openDb();
  let leased: OutboxItem | null = null;
  if (!db) {
    const picked = nextSendable(sortByRecordOrder(Array.from(memory.values()).filter((item) => item.userId === userId)), now, opts);
    if (picked) {
      leased = markSending(picked, now);
      memory.set(leased.id, leased);
    }
  } else {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const lookup = store.index(USER_INDEX).getAll(userId) as IDBRequest<OutboxItem[]>;
    lookup.onsuccess = () => {
      const picked = nextSendable(sortByRecordOrder(lookup.result), now, opts);
      if (!picked) return;
      leased = markSending(picked, now);
      store.put(leased);
    };
    await transactionDone(tx);
  }
  if (leased) notifyChanged(userId);
  return leased;
}

/** Reads item `id` and writes what `decide` returns for it, in one transaction. `decide` must not throw. */
async function changeItem<T>(id: string, decide: (current: OutboxItem | null) => OutboxChange<T>): Promise<T> {
  const db = await openDb();
  let change: OutboxChange<T> | null = null;
  let userId = '';
  if (!db) {
    const current = memory.get(id) ?? null;
    change = decide(current);
    userId = current?.userId ?? change.next?.userId ?? '';
    if (change.next === null) memory.delete(id);
    else if (change.next) memory.set(id, change.next);
  } else {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    // Write inside the request callback: the transaction stays active there in every engine.
    const lookup = store.get(id) as IDBRequest<OutboxItem | undefined>;
    lookup.onsuccess = () => {
      const current = lookup.result ?? null;
      const decided = decide(current);
      change = decided;
      userId = current?.userId ?? decided.next?.userId ?? '';
      if (decided.next === null) store.delete(id);
      else if (decided.next) store.put(decided.next);
    };
    await transactionDone(tx);
  }
  if (!change) throw new Error('outbox: the change was not applied');
  const applied: OutboxChange<T> = change;
  if (applied.next !== undefined) notifyChanged(userId);
  return applied.result;
}

async function clearUser(userId: string): Promise<void> {
  const db = await openDb();
  if (!db) {
    for (const [id, item] of memory) if (item.userId === userId) memory.delete(id);
  } else {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const lookup = store.index(USER_INDEX).getAllKeys(userId);
    lookup.onsuccess = () => {
      for (const key of lookup.result) store.delete(key);
    };
    await transactionDone(tx);
  }
  notifyChanged(userId);
}

export const outboxStore: {
  list(userId: string): Promise<OutboxItem[]>;
  put(item: OutboxItem): Promise<void>;
  remove(id: string): Promise<void>;
  clear(userId: string): Promise<void>;
  claimNext(userId: string, now: Date, opts?: { ignoreBackoff?: boolean }): Promise<OutboxItem | null>;
  change<T>(id: string, decide: (current: OutboxItem | null) => OutboxChange<T>): Promise<T>;
} = {
  list: listItems,
  put: putItem,
  remove: removeItem,
  clear: clearUser,
  claimNext,
  change: changeItem,
};
