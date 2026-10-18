/**
 * Native push of the iOS / Android apps: APNs (HTTP/2 + ES256 provider token from the `.p8` key)
 * and FCM HTTP v1 (OAuth2 service-account assertion, RS256). Only built-in `http2` / `crypto` /
 * `fetch` — no SDKs. Keys come from env (`APNS_*`, `FCM_*`); without them a platform is off and
 * nothing is sent. Called from `notifyUsers` next to web push — channel preferences are the same.
 *
 * Tokens the push service calls dead (APNs 410, FCM `UNREGISTERED`) are switched off
 * (`PushDevice.isActive = false`).
 */
import { createSign, sign as signData } from 'node:crypto';
import type { ClientHttp2Session } from 'node:http2';
import type { NotificationEventType } from '@/lib/notification-preferences';
import type { PushPayload } from '@/lib/web-push';

export type NativePlatform = 'ios' | 'android';
export const NATIVE_PLATFORMS: readonly NativePlatform[] = ['ios', 'android'];
/** Active native devices per user; older ones are switched off on registration. */
export const MAX_PUSH_DEVICES_PER_USER = 10;
/** One request to APNs / FCM (and the FCM token exchange). */
export const NATIVE_PUSH_TIMEOUT_MS = 5000;

export type ApnsConfig = { keyId: string; teamId: string; privateKey: string; bundleId: string; production: boolean };
export type FcmConfig = { projectId: string; clientEmail: string; privateKey: string };
export type NativePushEnv = Record<string, string | undefined>;

export function isNativePlatform(value: unknown): value is NativePlatform {
  return value === 'ios' || value === 'android';
}

/**
 * Device token as stored: APNs — hex (Capacitor gives it upper-case), lower-cased;
 * FCM — its own token alphabet. Anything else → null.
 */
export function normalizeDeviceToken(platform: NativePlatform, raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim();
  if (platform === 'ios') return /^[0-9a-fA-F]{64,200}$/.test(token) ? token.toLowerCase() : null;
  return /^[A-Za-z0-9_:.-]{20,4096}$/.test(token) ? token : null;
}

function envValue(env: NativePushEnv, name: string): string {
  return (env[name] || '').trim();
}

/** `.env` keeps a PEM on one line with literal `\n`. */
function envPem(env: NativePushEnv, name: string): string {
  return envValue(env, name).replace(/\\n/g, '\n').trim();
}

export function readApnsConfig(env: NativePushEnv = process.env): ApnsConfig | null {
  const keyId = envValue(env, 'APNS_KEY_ID');
  const teamId = envValue(env, 'APNS_TEAM_ID');
  const privateKey = envPem(env, 'APNS_PRIVATE_KEY');
  const bundleId = envValue(env, 'APNS_BUNDLE_ID');
  if (!keyId || !teamId || !privateKey || !bundleId) return null;
  const production = ['1', 'true', 'yes'].includes(envValue(env, 'APNS_PRODUCTION').toLowerCase());
  return { keyId, teamId, privateKey, bundleId, production };
}

export function readFcmConfig(env: NativePushEnv = process.env): FcmConfig | null {
  const projectId = envValue(env, 'FCM_PROJECT_ID');
  const clientEmail = envValue(env, 'FCM_CLIENT_EMAIL');
  const privateKey = envPem(env, 'FCM_PRIVATE_KEY');
  if (!projectId || !clientEmail || !privateKey) return null;
  return { projectId, clientEmail, privateKey };
}

/** Keys for `platform` are set (without `platform` — for at least one of them). */
export function isNativePushConfigured(platform?: NativePlatform, env: NativePushEnv = process.env): boolean {
  if (platform === 'ios') return readApnsConfig(env) !== null;
  if (platform === 'android') return readFcmConfig(env) !== null;
  return readApnsConfig(env) !== null || readFcmConfig(env) !== null;
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

function jwtHeadAndClaims(header: object, claims: object): string {
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
}

function epochSeconds(now: Date): number {
  return Math.floor(now.getTime() / 1000);
}

/** APNs provider token: ES256 with the `.p8` key, `kid` = key id, `iss` = team id. */
export function apnsJwt(cfg: ApnsConfig, now: Date): string {
  const unsigned = jwtHeadAndClaims({ alg: 'ES256', kid: cfg.keyId }, { iss: cfg.teamId, iat: epochSeconds(now) });
  const signature = signData('sha256', Buffer.from(unsigned), { key: cfg.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${unsigned}.${base64url(signature)}`;
}

const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

/** Service-account assertion exchanged at Google for an FCM access token (RS256, one hour). */
export function fcmAccessTokenAssertion(cfg: FcmConfig, now: Date): string {
  const iat = epochSeconds(now);
  const unsigned = jwtHeadAndClaims(
    { alg: 'RS256', typ: 'JWT' },
    { iss: cfg.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + 3600 },
  );
  const signer = createSign('RSA-SHA256');
  signer.update(unsigned);
  return `${unsigned}.${base64url(signer.sign(cfg.privateKey))}`;
}

const MAX_TITLE = 200;
const MAX_BODY = 1000;

function payloadParts(payload: PushPayload) {
  return {
    title: payload.title.slice(0, MAX_TITLE),
    body: (payload.body || '').slice(0, MAX_BODY),
    link: payload.link || '/',
    tag: payload.tag || 'pushup-general',
  };
}

export type ApnsRequest = { origin: string; path: string; headers: Record<string, string>; body: string };

/** APNs request without `authorization` (the sender adds the cached provider token). */
export function buildApnsRequest(payload: PushPayload, token: string, cfg: ApnsConfig): ApnsRequest {
  const { title, body, link, tag } = payloadParts(payload);
  return {
    origin: cfg.production ? 'https://api.push.apple.com' : 'https://api.sandbox.push.apple.com',
    path: `/3/device/${token}`,
    headers: {
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      // one visible push per tag, like web push (APNs limit: 64 bytes)
      'apns-collapse-id': tag.slice(0, 64),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ aps: { alert: { title, body }, sound: 'default', 'thread-id': tag }, link }),
  };
}

export type FcmMessage = {
  message: {
    token: string;
    notification: { title: string; body: string };
    data: { link: string; tag: string };
    android: { priority: 'HIGH'; notification: { tag: string; sound: string } };
  };
};

/** FCM HTTP v1 message; `data.link` is what the app's tap handler opens. */
export function buildFcmMessage(payload: PushPayload, token: string): FcmMessage {
  const { title, body, link, tag } = payloadParts(payload);
  return {
    message: {
      token,
      notification: { title, body },
      data: { link, tag },
      android: { priority: 'HIGH', notification: { tag, sound: 'default' } },
    },
  };
}

export type NativeSendResult = 'sent' | 'dead' | 'failed';

/** APNs: 2xx — delivered; 410 `Unregistered` — the token is no longer valid for the topic. */
export function classifyApnsResponse(status: number, body: string): NativeSendResult {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 410 || apnsReason(body) === 'Unregistered') return 'dead';
  return 'failed';
}

/** FCM v1: 2xx — accepted; error detail `UNREGISTERED` — the app instance is gone. */
export function classifyFcmResponse(status: number, body: string): NativeSendResult {
  if (status >= 200 && status < 300) return 'sent';
  try {
    const details = (JSON.parse(body) as { error?: { details?: Array<{ errorCode?: unknown }> } }).error?.details;
    if (Array.isArray(details) && details.some((d) => d?.errorCode === 'UNREGISTERED')) return 'dead';
  } catch {}
  return 'failed';
}

export type StoredPushDevice = { id: string; platform: string; token: string };
export type NativeHttpResponse = { status: number; body: string };

export type NativePushDeps = {
  env: NativePushEnv;
  now(): Date;
  /** Active devices of not deleted users. */
  findDevices(userIds: string[]): Promise<StoredPushDevice[]>;
  deactivate(ids: string[]): Promise<unknown>;
  /** Users among `userIds` with the push channel on for `eventType`. */
  filterUsers?(userIds: string[], eventType: NotificationEventType): Promise<string[]>;
  sendApns(request: ApnsRequest, cfg: ApnsConfig): Promise<NativeHttpResponse>;
  sendFcm(message: FcmMessage, cfg: FcmConfig): Promise<NativeHttpResponse>;
  logError(label: string, error: unknown): void;
};

export type NativePushSummary = { sent: number; dead: number; failed: number };

/**
 * Push to every active native device of `userIds` on the platforms whose keys are set.
 * Without keys — returns at once without touching the DB. Never throws.
 */
export async function sendNativePushToUsers(
  userIds: string[],
  payload: PushPayload,
  eventType?: NotificationEventType,
  deps: NativePushDeps = defaultDeps(),
): Promise<NativePushSummary> {
  const summary: NativePushSummary = { sent: 0, dead: 0, failed: 0 };
  const apns = readApnsConfig(deps.env);
  const fcm = readFcmConfig(deps.env);
  let ids = Array.from(new Set(userIds.filter(Boolean)));
  if ((!apns && !fcm) || !ids.length) return summary;

  try {
    if (eventType && deps.filterUsers) ids = await deps.filterUsers(ids, eventType);
    if (!ids.length) return summary;
    const devices = await deps.findDevices(ids);
    const dead: string[] = [];

    await Promise.all(devices.map(async (device) => {
      let result: NativeSendResult;
      try {
        if (device.platform === 'ios' && apns) {
          const res = await deps.sendApns(buildApnsRequest(payload, device.token, apns), apns);
          result = classifyApnsResponse(res.status, res.body);
          if (result === 'failed') deps.logError('APNS SEND ERROR', new Error(`APNs status ${res.status} ${apnsReason(res.body)}`.trim()));
        } else if (device.platform === 'android' && fcm) {
          const res = await deps.sendFcm(buildFcmMessage(payload, device.token), fcm);
          result = classifyFcmResponse(res.status, res.body);
          if (result === 'failed') deps.logError('FCM SEND ERROR', new Error(`FCM status ${res.status}`));
        } else {
          return;
        }
      } catch (error) {
        deps.logError(device.platform === 'ios' ? 'APNS SEND ERROR' : 'FCM SEND ERROR', error);
        result = 'failed';
      }
      summary[result] += 1;
      if (result === 'dead') dead.push(device.id);
    }));

    if (dead.length) await deps.deactivate(dead);
  } catch (error) {
    deps.logError('NATIVE PUSH ERROR', error);
  }
  return summary;
}

function apnsReason(body: string): string {
  try {
    const reason = (JSON.parse(body) as { reason?: unknown }).reason;
    return typeof reason === 'string' ? reason : '';
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Real transport (not used by tests): cached provider / access tokens, one HTTP/2 session.
// ---------------------------------------------------------------------------

/** APNs accepts a provider token for an hour and rejects refreshing it more often than every 20 min. */
const APNS_JWT_TTL_MS = 50 * 60 * 1000;
let apnsJwtCache: { key: string; jwt: string; issuedAt: number } | null = null;

function cachedApnsJwt(cfg: ApnsConfig): string {
  const key = `${cfg.teamId}:${cfg.keyId}`;
  const now = Date.now();
  if (apnsJwtCache && apnsJwtCache.key === key && now - apnsJwtCache.issuedAt < APNS_JWT_TTL_MS) return apnsJwtCache.jwt;
  const jwt = apnsJwt(cfg, new Date(now));
  apnsJwtCache = { key, jwt, issuedAt: now };
  return jwt;
}

let apnsSession: { origin: string; session: ClientHttp2Session; inFlight: number } | null = null;

async function apnsSessionFor(origin: string) {
  const current = apnsSession;
  if (current && current.origin === origin && !current.session.closed && !current.session.destroyed) return current;
  const http2 = await import('node:http2');
  const session = http2.connect(origin);
  const entry = { origin, session, inFlight: 0 };
  // errors reach the streams; a broken session is dropped and reconnected next time
  session.on('error', () => {});
  session.on('close', () => {
    if (apnsSession === entry) apnsSession = null;
  });
  // idle connection does not keep the process alive and is closed after a minute
  session.unref();
  session.setTimeout(60_000, () => session.close());
  apnsSession = entry;
  return entry;
}

async function sendApnsOverHttp2(request: ApnsRequest, cfg: ApnsConfig): Promise<NativeHttpResponse> {
  const entry = await apnsSessionFor(request.origin);
  const { session } = entry;
  entry.inFlight += 1;
  session.ref();
  try {
    const response = await new Promise<NativeHttpResponse>((resolve, reject) => {
      const stream = session.request({
        ':method': 'POST',
        ':path': request.path,
        authorization: `bearer ${cachedApnsJwt(cfg)}`,
        ...request.headers,
      });
      let status = 0;
      let body = '';
      stream.setEncoding('utf8');
      stream.setTimeout(NATIVE_PUSH_TIMEOUT_MS, () => {
        stream.close();
        reject(new Error('APNs request timed out'));
      });
      stream.on('response', (headers) => {
        status = Number(headers[':status']) || 0;
      });
      stream.on('data', (chunk: string) => {
        body += chunk;
      });
      stream.on('end', () => resolve({ status, body }));
      stream.on('error', reject);
      stream.end(request.body);
    });
    // the key was rotated or the token aged out: issue a new one next time
    if (response.status === 403 && /ProviderToken/.test(apnsReason(response.body))) apnsJwtCache = null;
    return response;
  } finally {
    entry.inFlight -= 1;
    if (entry.inFlight === 0) session.unref();
  }
}

let fcmTokenCache: { key: string; token: string; expiresAt: number } | null = null;

async function fcmAccessToken(cfg: FcmConfig): Promise<string> {
  const key = `${cfg.projectId}:${cfg.clientEmail}`;
  const now = Date.now();
  if (fcmTokenCache && fcmTokenCache.key === key && fcmTokenCache.expiresAt - 60_000 > now) return fcmTokenCache.token;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: fcmAccessTokenAssertion(cfg, new Date(now)),
    }),
    signal: AbortSignal.timeout(NATIVE_PUSH_TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown };
  if (!res.ok || typeof data.access_token !== 'string') throw new Error(`FCM access token request failed: ${res.status}`);
  const ttlSeconds = typeof data.expires_in === 'number' ? data.expires_in : 3600;
  fcmTokenCache = { key, token: data.access_token, expiresAt: now + ttlSeconds * 1000 };
  return data.access_token;
}

async function sendFcmOverHttp(message: FcmMessage, cfg: FcmConfig): Promise<NativeHttpResponse> {
  const accessToken = await fcmAccessToken(cfg);
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(cfg.projectId)}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(NATIVE_PUSH_TIMEOUT_MS),
  });
  if (res.status === 401) fcmTokenCache = null;
  return { status: res.status, body: await res.text().catch(() => '') };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function defaultDeps(): NativePushDeps {
  return {
    env: process.env,
    now: () => new Date(),
    findDevices: async (userIds) => {
      const { prisma } = await import('@/lib/prisma');
      return prisma.pushDevice.findMany({
        where: { userId: { in: userIds }, isActive: true, user: { deletedAt: null } },
        select: { id: true, platform: true, token: true },
      });
    },
    deactivate: async (ids) => {
      const { prisma } = await import('@/lib/prisma');
      await prisma.pushDevice.updateMany({ where: { id: { in: ids } }, data: { isActive: false } });
    },
    filterUsers: async (userIds, eventType) => {
      const { filterUsersByChannel } = await import('@/lib/notification-preferences');
      return filterUsersByChannel(userIds, eventType, 'push');
    },
    sendApns: sendApnsOverHttp2,
    sendFcm: sendFcmOverHttp,
    logError: (label, error) => {
      console.error(`${label}:`, errorText(error));
    },
  };
}
