/**
 * Native push devices of the iOS / Android apps (APNs / FCM tokens, model `PushDevice`): the logic
 * behind `POST|DELETE /api/push/devices` and `POST /api/logout { pushToken }`.
 *
 * - register: upsert by token — a token re-registered by another account moves to it and is switched
 *   back on; at most `MAX_PUSH_DEVICES_PER_USER` active devices per user (the oldest are switched off);
 *   at most `PUSH_DEVICE_REGISTER_LIMIT_PER_HOUR` attempts an hour per user (every attempt counts);
 * - remove: the device with this token, whoever it is registered to — the app of a user who keeps
 *   push off releases a token left on the phone by the previous account (shared phone, sign-out
 *   without connection). Knowing the long secret token is the proof, as in register, which can
 *   already move it;
 * - logout: the device of the signed-in user is removed; one the session cannot vouch for (expired
 *   or revoked session, another account's token) is only switched off and comes back with its
 *   owner's next registration.
 */
import { MAX_PUSH_DEVICES_PER_USER, isNativePlatform, normalizeDeviceToken, type NativePlatform } from './native-push';
import { subscriptionsToEvict } from './push-endpoint';

export const PUSH_DEVICE_REGISTER_LIMIT_PER_HOUR = 20;
const HOUR_SECONDS = 60 * 60;
const MAX_TOKEN_LENGTH = 4096;

type DeviceData = { userId: string; platform: NativePlatform; isActive: boolean };
type DeviceWhere = { id?: { in: string[] }; userId?: string; token?: string | { in: string[] }; isActive?: boolean };

/** The part of Prisma's `pushDevice` delegate this module uses (`prisma` fits as is). */
export type PushDeviceDb = {
  pushDevice: {
    upsert(args: { where: { token: string }; update: DeviceData; create: DeviceData & { token: string } }): Promise<unknown>;
    updateMany(args: { where: DeviceWhere; data: Partial<DeviceData> }): Promise<unknown>;
    findMany(args: { where: DeviceWhere; select: { id: true; updatedAt: true } }): Promise<Array<{ id: string; updatedAt: Date }>>;
    deleteMany(args: { where: DeviceWhere }): Promise<unknown>;
  };
};

export type PushDeviceDeps = {
  db: PushDeviceDb;
  hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfterSeconds: number }>;
};

export type PushDeviceResult =
  | { ok: true }
  | { ok: false; status: 400; error: string }
  | { ok: false; status: 429; retryAfterSeconds: number };

function badRequest(error: string): PushDeviceResult {
  return { ok: false, status: 400, error };
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'P2002';
}

/** The token as sent and as stored (APNs tokens are stored lower-cased; FCM tokens as they are). */
function tokenVariants(token: string): string[] {
  return Array.from(new Set([token, token.toLowerCase()]));
}

/** `POST /api/push/devices { platform, token }` for `userId`. */
export async function registerPushDevice(userId: string, body: unknown, deps: PushDeviceDeps): Promise<PushDeviceResult> {
  const limit = await deps.hitRateLimit(`push-device-register:${userId}`, PUSH_DEVICE_REGISTER_LIMIT_PER_HOUR, HOUR_SECONDS);
  if (!limit.ok) return { ok: false, status: 429, retryAfterSeconds: limit.retryAfterSeconds };

  const platform = field(body, 'platform');
  if (!isNativePlatform(platform)) return badRequest('Некорректная платформа');
  const token = normalizeDeviceToken(platform, field(body, 'token'));
  if (!token) return badRequest('Некорректный токен устройства');

  const { pushDevice } = deps.db;
  const data: DeviceData = { userId, platform, isActive: true };
  try {
    await pushDevice.upsert({ where: { token }, update: data, create: { ...data, token } });
  } catch (error) {
    // Two registrations of one device at once: the second one hits unique(token).
    if (!isUniqueViolation(error)) throw error;
    await pushDevice.updateMany({ where: { token }, data });
  }

  const active = await pushDevice.findMany({ where: { userId, isActive: true }, select: { id: true, updatedAt: true } });
  const evict = subscriptionsToEvict(active, MAX_PUSH_DEVICES_PER_USER);
  if (evict.length) await pushDevice.updateMany({ where: { id: { in: evict } }, data: { isActive: false } });
  return { ok: true };
}

/** `DELETE /api/push/devices { token }`: removes the device with this token, whoever owns it. */
export async function removePushDevice(body: unknown, db: PushDeviceDb): Promise<PushDeviceResult> {
  const raw = field(body, 'token');
  const token = typeof raw === 'string' ? raw.trim() : '';
  if (!token) return badRequest('Не указан токен устройства');
  await db.pushDevice.deleteMany({ where: { token: { in: tokenVariants(token.slice(0, MAX_TOKEN_LENGTH)) } } });
  return { ok: true };
}

/**
 * `POST /api/logout { pushToken }`: the phone stops getting push. `userId` — the user of the session
 * being closed, null when it is no longer valid. Best effort: errors are swallowed, sign-out goes on.
 */
export async function releasePushTokenOnLogout(pushToken: string, userId: string | null, db: PushDeviceDb): Promise<void> {
  const token = pushToken.trim().slice(0, MAX_TOKEN_LENGTH);
  if (!token) return;
  const tokens = { in: tokenVariants(token) };
  if (userId) await db.pushDevice.deleteMany({ where: { userId, token: tokens } }).catch(() => {});
  await db.pushDevice.updateMany({ where: { token: tokens, isActive: true }, data: { isActive: false } }).catch(() => {});
}
