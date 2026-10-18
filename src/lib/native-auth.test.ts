import test from 'node:test';
import assert from 'node:assert/strict';
import { readStoredToken, removeStoredToken, type TokenRemovalMarker, type TokenStorage } from './native-auth';

const TOKEN = 'a'.repeat(64);

function fakeStorage(opts: { failRemovals?: number; value?: string | null } = {}) {
  const state = { value: opts.value ?? TOKEN as string | null, removeCalls: 0, failRemovals: opts.failRemovals ?? 0 };
  const storage: TokenStorage = {
    get: async () => state.value,
    remove: async () => {
      state.removeCalls += 1;
      if (state.failRemovals > 0) {
        state.failRemovals -= 1;
        throw new Error('storage_write_failed');
      }
      state.value = null;
    },
  };
  return { state, storage };
}

function fakeMarker(pending = false) {
  const state = { pending };
  const marker: TokenRemovalMarker = {
    isPending: () => state.pending,
    setPending: (value) => {
      state.pending = value;
    },
  };
  return { state, marker };
}

test('sign-out: a failing remove is retried; success clears the pending mark', async () => {
  const { state, storage } = fakeStorage({ failRemovals: 1 });
  const { state: mark, marker } = fakeMarker();
  assert.equal(await removeStoredToken(storage, marker), true);
  assert.equal(state.removeCalls, 2);
  assert.equal(state.value, null);
  assert.equal(mark.pending, false);
});

test('sign-out: remove that keeps failing is reported (false) and leaves the pending mark', async () => {
  const { state, storage } = fakeStorage({ failRemovals: 10 });
  const { state: mark, marker } = fakeMarker();
  assert.equal(await removeStoredToken(storage, marker, 3), false);
  assert.equal(state.removeCalls, 3);
  assert.equal(mark.pending, true);
});

test('next start after a failed removal: the stored token is not used (sign-in screen) and removal is retried', async () => {
  const { state, storage } = fakeStorage();
  const { state: mark, marker } = fakeMarker(true);
  assert.equal(await readStoredToken(storage, marker), null);
  assert.equal(state.value, null, 'removal retried at start');
  assert.equal(mark.pending, false);
});

test('next start while the storage still cannot remove: still no token, mark stays', async () => {
  const { storage } = fakeStorage({ failRemovals: 10 });
  const { state: mark, marker } = fakeMarker(true);
  assert.equal(await readStoredToken(storage, marker), null);
  assert.equal(mark.pending, true);
});

test('normal start: the stored token is returned', async () => {
  const { storage } = fakeStorage();
  const { marker } = fakeMarker(false);
  assert.equal(await readStoredToken(storage, marker), TOKEN);
});
