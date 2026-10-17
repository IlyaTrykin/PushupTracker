/**
 * Device storage of the outbox: IndexedDB 'pushup-outbox', store 'items' (key `id`, index `userId`).
 * It survives reloads and app restarts; every change fires window 'outboxChanged'.
 * Without IndexedDB (rare private modes) items live in memory until the page closes.
 */

import type { OutboxItem } from './outbox-core';

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
  return items.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
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
} = {
  list: listItems,
  put: putItem,
  remove: removeItem,
  clear: clearUser,
};
