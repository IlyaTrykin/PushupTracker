import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerify, generateKeyPairSync, verify as verifySignature } from 'node:crypto';
import {
  apnsJwt,
  buildApnsRequest,
  buildFcmMessage,
  classifyApnsResponse,
  classifyFcmResponse,
  fcmAccessTokenAssertion,
  isNativePushConfigured,
  normalizeDeviceToken,
  readApnsConfig,
  readFcmConfig,
  sendNativePushToUsers,
  type ApnsConfig,
  type FcmConfig,
  type NativePushDeps,
  type StoredPushDevice,
} from './native-push';

const ec = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ecPem = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const rsaPem = rsa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

const apnsCfg: ApnsConfig = { keyId: 'KEY123ABCD', teamId: 'TEAM123456', privateKey: ecPem, bundleId: 'app.example.test', production: false };
const fcmCfg: FcmConfig = { projectId: 'demo-project', clientEmail: 'push@demo-project.iam.example.test', privateKey: rsaPem };

const fullEnv = {
  APNS_KEY_ID: apnsCfg.keyId,
  APNS_TEAM_ID: apnsCfg.teamId,
  // .env keeps the PEM on one line with literal \n
  APNS_PRIVATE_KEY: ecPem.replace(/\n/g, '\\n'),
  APNS_BUNDLE_ID: apnsCfg.bundleId,
  APNS_PRODUCTION: '',
  FCM_PROJECT_ID: fcmCfg.projectId,
  FCM_CLIENT_EMAIL: fcmCfg.clientEmail,
  FCM_PRIVATE_KEY: rsaPem.replace(/\n/g, '\\n'),
};

function decodePart(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
}

const IOS_TOKEN = 'a'.repeat(64);
const ANDROID_TOKEN = 'fcm-token_ABCdef:123-xyz.' + 'q'.repeat(40);

test('without env the native channel is off for every platform', () => {
  assert.equal(isNativePushConfigured(undefined, {}), false);
  assert.equal(isNativePushConfigured('ios', {}), false);
  assert.equal(isNativePushConfigured('android', {}), false);
  assert.equal(readApnsConfig({}), null);
  assert.equal(readFcmConfig({}), null);
});

test('each platform is configured by its own keys only', () => {
  const iosOnly = { ...fullEnv, FCM_PROJECT_ID: '', FCM_CLIENT_EMAIL: '', FCM_PRIVATE_KEY: '' };
  assert.equal(isNativePushConfigured('ios', iosOnly), true);
  assert.equal(isNativePushConfigured('android', iosOnly), false);
  assert.equal(isNativePushConfigured(undefined, iosOnly), true);
  assert.equal(isNativePushConfigured('android', fullEnv), true);
  // a missing part (here the team id) switches APNs off
  assert.equal(isNativePushConfigured('ios', { ...fullEnv, APNS_TEAM_ID: ' ' }), false);
});

test('private keys from env get their real line breaks back; APNS_PRODUCTION=1 picks production', () => {
  assert.equal(readApnsConfig(fullEnv)?.privateKey, ecPem.trim());
  assert.equal(readFcmConfig(fullEnv)?.privateKey, rsaPem.trim());
  assert.equal(readApnsConfig(fullEnv)?.production, false);
  assert.equal(readApnsConfig({ ...fullEnv, APNS_PRODUCTION: '1' })?.production, true);
});

test('apnsJwt: ES256 token with kid, iss = team, iat in seconds, verifiable with the key', () => {
  const now = new Date('2026-10-18T10:00:00.900Z');
  const jwt = apnsJwt(apnsCfg, now);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(decodePart(h), { alg: 'ES256', kid: 'KEY123ABCD' });
  assert.deepEqual(decodePart(p), { iss: 'TEAM123456', iat: 1_792_317_600 });
  const signature = Buffer.from(s, 'base64url');
  assert.equal(signature.length, 64, 'JOSE ES256 signature is raw r||s, 64 bytes');
  assert.equal(
    verifySignature('sha256', Buffer.from(`${h}.${p}`), { key: ec.publicKey, dsaEncoding: 'ieee-p1363' }, signature),
    true,
  );
});

test('fcmAccessTokenAssertion: RS256 service-account assertion for the FCM scope, one hour', () => {
  const now = new Date('2026-10-18T10:00:00Z');
  const jwt = fcmAccessTokenAssertion(fcmCfg, now);
  const [h, p, s] = jwt.split('.');
  assert.deepEqual(decodePart(h), { alg: 'RS256', typ: 'JWT' });
  assert.deepEqual(decodePart(p), {
    iss: 'push@demo-project.iam.example.test',
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: 1_792_317_600,
    exp: 1_792_321_200,
  });
  const verifier = createVerify('RSA-SHA256');
  verifier.update(`${h}.${p}`);
  assert.equal(verifier.verify(rsa.publicKey, Buffer.from(s, 'base64url')), true);
});

test('buildApnsRequest: sandbox host for development, alert push to the device with link and tag', () => {
  const req = buildApnsRequest({ title: 'Цель дня', body: 'Осталось 20 баллов', link: '/challenges/abc', tag: 'pushup-daily_goal_reminder' }, IOS_TOKEN, apnsCfg);
  assert.equal(req.origin, 'https://api.sandbox.push.apple.com');
  assert.equal(req.path, `/3/device/${IOS_TOKEN}`);
  assert.equal(req.headers['apns-topic'], 'app.example.test');
  assert.equal(req.headers['apns-push-type'], 'alert');
  assert.equal(req.headers['apns-priority'], '10');
  assert.equal(req.headers['apns-collapse-id'], 'pushup-daily_goal_reminder');
  assert.deepEqual(JSON.parse(req.body), {
    aps: { alert: { title: 'Цель дня', body: 'Осталось 20 баллов' }, sound: 'default', 'thread-id': 'pushup-daily_goal_reminder' },
    link: '/challenges/abc',
  });
  assert.equal(buildApnsRequest({ title: 't' }, IOS_TOKEN, { ...apnsCfg, production: true }).origin, 'https://api.push.apple.com');
  assert.equal(JSON.parse(buildApnsRequest({ title: 't' }, IOS_TOKEN, apnsCfg).body).link, '/');
});

test('buildFcmMessage: notification + string data with link and tag for the tap handler', () => {
  assert.deepEqual(buildFcmMessage({ title: 'Заявка в друзья', body: 'Петя', link: '/friends', tag: 'pushup-friend_request' }, ANDROID_TOKEN), {
    message: {
      token: ANDROID_TOKEN,
      notification: { title: 'Заявка в друзья', body: 'Петя' },
      data: { link: '/friends', tag: 'pushup-friend_request' },
      android: { priority: 'HIGH', notification: { tag: 'pushup-friend_request', sound: 'default' } },
    },
  });
  const minimal = buildFcmMessage({ title: 'x' }, ANDROID_TOKEN).message;
  assert.deepEqual(minimal.data, { link: '/', tag: 'pushup-general' });
  assert.equal(minimal.notification.body, '');
});

test('dead tokens: APNs 410 and FCM UNREGISTERED; other errors are not treated as dead', () => {
  assert.equal(classifyApnsResponse(200, ''), 'sent');
  assert.equal(classifyApnsResponse(410, '{"reason":"Unregistered"}'), 'dead');
  assert.equal(classifyApnsResponse(400, '{"reason":"BadDeviceToken"}'), 'failed');
  assert.equal(classifyApnsResponse(500, ''), 'failed');
  assert.equal(classifyFcmResponse(200, '{"name":"projects/x/messages/1"}'), 'sent');
  const unregistered = JSON.stringify({
    error: { code: 404, status: 'NOT_FOUND', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] },
  });
  assert.equal(classifyFcmResponse(404, unregistered), 'dead');
  assert.equal(classifyFcmResponse(400, JSON.stringify({ error: { status: 'INVALID_ARGUMENT', details: [{ errorCode: 'INVALID_ARGUMENT' }] } })), 'failed');
  assert.equal(classifyFcmResponse(503, 'oops'), 'failed');
});

test('device tokens: APNs hex lowercased, FCM token charset; garbage rejected', () => {
  assert.equal(normalizeDeviceToken('ios', 'AB'.repeat(32)), 'ab'.repeat(32));
  assert.equal(normalizeDeviceToken('ios', 'zz'.repeat(32)), null);
  assert.equal(normalizeDeviceToken('ios', 'ab'), null);
  assert.equal(normalizeDeviceToken('android', ANDROID_TOKEN), ANDROID_TOKEN);
  assert.equal(normalizeDeviceToken('android', 'short'), null);
  assert.equal(normalizeDeviceToken('android', 'has space'.repeat(5)), null);
  assert.equal(normalizeDeviceToken('android', 42), null);
});

function fakeDeps(env: Record<string, string>, devices: StoredPushDevice[], responses: { ios?: [number, string] | Error; android?: [number, string] | Error } = {}) {
  const calls = { findDevices: 0, apns: [] as string[], fcm: [] as string[], deactivated: [] as string[], errors: [] as string[] };
  const deps: NativePushDeps = {
    env,
    now: () => new Date('2026-10-18T10:00:00Z'),
    findDevices: async () => {
      calls.findDevices += 1;
      return devices;
    },
    deactivate: async (ids) => {
      calls.deactivated.push(...ids);
    },
    sendApns: async (req) => {
      calls.apns.push(req.path);
      const r = responses.ios ?? [200, ''];
      if (r instanceof Error) throw r;
      return { status: r[0], body: r[1] };
    },
    sendFcm: async (msg) => {
      calls.fcm.push(msg.message.token);
      const r = responses.android ?? [200, '{}'];
      if (r instanceof Error) throw r;
      return { status: r[0], body: r[1] };
    },
    logError: (label) => {
      calls.errors.push(label);
    },
  };
  return { deps, calls };
}

const devices: StoredPushDevice[] = [
  { id: 'd-ios', platform: 'ios', token: IOS_TOKEN },
  { id: 'd-android', platform: 'android', token: ANDROID_TOKEN },
];

test('sendNativePushToUsers without keys: does not touch the DB, sends nothing, does not throw', async () => {
  const { deps, calls } = fakeDeps({}, devices);
  const result = await sendNativePushToUsers(['u1'], { title: 'x' }, undefined, deps);
  assert.deepEqual(result, { sent: 0, dead: 0, failed: 0 });
  assert.equal(calls.findDevices, 0);
  assert.deepEqual(calls.apns, []);
  assert.deepEqual(calls.fcm, []);
});

test('sendNativePushToUsers: every active device gets its platform push; dead tokens are switched off', async () => {
  const { deps, calls } = fakeDeps(fullEnv, devices, { ios: [410, '{"reason":"Unregistered"}'] });
  const result = await sendNativePushToUsers(['u1'], { title: 'x', link: '/friends' }, undefined, deps);
  assert.deepEqual(calls.apns, [`/3/device/${IOS_TOKEN}`]);
  assert.deepEqual(calls.fcm, [ANDROID_TOKEN]);
  assert.deepEqual(calls.deactivated, ['d-ios']);
  assert.deepEqual(result, { sent: 1, dead: 1, failed: 0 });
});

test('sendNativePushToUsers: only configured platforms are used; send errors are logged, not thrown, token kept', async () => {
  const iosOnly = { ...fullEnv, FCM_PROJECT_ID: '', FCM_CLIENT_EMAIL: '', FCM_PRIVATE_KEY: '' };
  const { deps, calls } = fakeDeps(iosOnly, devices, { ios: new Error('socket hang up') });
  const result = await sendNativePushToUsers(['u1'], { title: 'x' }, undefined, deps);
  assert.deepEqual(calls.fcm, []);
  assert.deepEqual(calls.deactivated, []);
  assert.deepEqual(result, { sent: 0, dead: 0, failed: 1 });
  assert.equal(calls.errors.length, 1);
});
