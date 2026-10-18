import test from 'node:test';
import assert from 'node:assert/strict';
import { installPushActionHandler, isNativePushAvailable, pushActionRoute, registerNativePush, type NativePushAvailabilityDeps } from './native-push-client';

type Listener = Parameters<NonNullable<Parameters<typeof installPushActionHandler>[1]>>[0];

function fakeListen() {
  const state: { listener: Listener | null; removed: boolean } = { listener: null, removed: false };
  const addListener = async (listener: Listener) => {
    state.listener = listener;
    return { remove: async () => { state.removed = true; } };
  };
  return { state, addListener };
}

const tap = (data: unknown, actionId = 'tap') => ({ actionId, notification: { id: '1', data } });

test('pushActionRoute: link from the push becomes the app route (dynamic pages via query params)', () => {
  assert.equal(pushActionRoute(tap({ link: '/challenges/abc?x=1' })), '/challenges/view?id=abc&x=1');
  assert.equal(pushActionRoute(tap({ link: '/groups/g1' })), '/groups/view?id=g1');
  assert.equal(pushActionRoute(tap({ link: '/friends' })), '/friends');
});

test('pushActionRoute: no link, external or protocol-relative links, dismiss — nothing to open', () => {
  assert.equal(pushActionRoute(tap({})), null);
  assert.equal(pushActionRoute(tap({ link: 'https://example.test/x' })), null);
  assert.equal(pushActionRoute(tap({ link: '//example.test/x' })), null);
  assert.equal(pushActionRoute(tap({ link: '/friends' }, 'dismiss')), null);
  assert.equal(pushActionRoute({}), null);
});

test('installPushActionHandler: a tap on a push navigates through the router to toAppRoute(link); cleanup removes the listener', async () => {
  const { state, addListener } = fakeListen();
  const visited: string[] = [];
  const stop = installPushActionHandler((path) => visited.push(path), addListener);
  await Promise.resolve();
  assert.ok(state.listener, 'listener is registered');
  state.listener?.(tap({ link: '/program/p1' }));
  state.listener?.(tap({ link: 'https://example.test' }));
  assert.deepEqual(visited, ['/program/view?id=p1']);
  stop();
  await Promise.resolve();
  assert.equal(state.removed, true);
});

function availability(platform: 'ios' | 'android' | null, firebase: boolean, server: boolean) {
  const calls = { firebase: 0, server: 0 };
  const deps: NativePushAvailabilityDeps = {
    platform: () => platform,
    firebaseConfigured: async () => {
      calls.firebase += 1;
      return firebase;
    },
    serverConfigured: async () => {
      calls.server += 1;
      return server;
    },
  };
  return { deps, calls };
}

test('Android build without Firebase config: unavailable even when the server has FCM keys (register() would crash)', async () => {
  const { deps, calls } = availability('android', false, true);
  assert.equal(await isNativePushAvailable(deps), false);
  assert.equal(calls.server, 0);
  assert.equal(await registerNativePush('u1', {}, deps), 'unavailable');
});

test('Android with Firebase config follows the server keys; iOS does not need Firebase; the site never has native push', async () => {
  assert.equal(await isNativePushAvailable(availability('android', true, true).deps), true);
  assert.equal(await isNativePushAvailable(availability('android', true, false).deps), false);
  const ios = availability('ios', false, true);
  assert.equal(await isNativePushAvailable(ios.deps), true);
  assert.equal(ios.calls.firebase, 0);
  assert.equal(await isNativePushAvailable(availability(null, true, true).deps), false);
});

test('a failing build check (plugin missing in an older app) counts as no Firebase', async () => {
  const { deps } = availability('android', true, true);
  deps.firebaseConfigured = async () => {
    throw new Error('PushConfig plugin is not implemented');
  };
  assert.equal(await isNativePushAvailable(deps), false);
});
