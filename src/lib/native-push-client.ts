/**
 * Native push in the iOS / Android app (`@capacitor/push-notifications`): permission, APNs / FCM
 * token → `POST /api/push/devices`, and the tap handler (push `data.link` → `toAppRoute`, through
 * the router). Push is available only when the server has APNs / FCM keys and — on Android — the
 * build itself has the Firebase config (`google-services.json`): without it `register()` crashes the
 * app, whatever the server says. Otherwise the profile says push will come after publication and
 * `register()` is never called.
 */
import { registerPlugin } from '@capacitor/core';
import { PushNotifications, type ActionPerformed } from '@capacitor/push-notifications';
import { toAppRoute } from './app-routes';
import { nativePlatform } from './platform';

export type NativePushRegistration = 'registered' | 'denied' | 'unavailable';
export type NativePushPermission = 'granted' | 'denied' | 'prompt';

const TOKEN_KEY = 'native-push-token:v1';
const WANTED_PREFIX = 'native-push-wanted:v1:';
const REGISTER_TIMEOUT_MS = 15_000;

function storageGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function storageSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
}

/** APNs / FCM token of this device from the last registration (sent on sign-out). */
export function currentPushToken(): string | null {
  return storageGet(TOKEN_KEY);
}

/** The user turned native push on on this device (restored silently on the next start). */
export function isNativePushWanted(userId: string | null | undefined): boolean {
  return Boolean(userId) && storageGet(WANTED_PREFIX + userId) === '1';
}

function setNativePushWanted(userId: string | null | undefined, wanted: boolean): void {
  if (userId) storageSet(WANTED_PREFIX + userId, wanted ? '1' : null);
}

/** Android-only local plugin (`PushConfigPlugin.kt`): is the Firebase config compiled into this build. */
const PushConfig = registerPlugin<{ status(): Promise<{ firebaseConfigured: boolean }> }>('PushConfig');

export type NativePushAvailabilityDeps = {
  platform(): 'ios' | 'android' | null;
  /** Android: the build has the Firebase config (`google-services.json`). */
  firebaseConfigured(): Promise<boolean>;
  /** The server has APNs (iOS) / FCM (Android) keys. */
  serverConfigured(platform: 'ios' | 'android'): Promise<boolean>;
};

const defaultAvailability: NativePushAvailabilityDeps = {
  platform: nativePlatform,
  firebaseConfigured: async () => (await PushConfig.status()).firebaseConfigured === true,
  serverConfigured: async (platform) => {
    try {
      const res = await fetch(`/api/push/subscriptions?platform=${platform}`, { cache: 'no-store' });
      const data = (await res.json().catch(() => ({}))) as { nativeConfigured?: unknown };
      return res.ok && data.nativeConfigured === true;
    } catch {
      return false;
    }
  },
};

/**
 * Native push can be turned on here: an app build (not the site); on Android the build has the
 * Firebase config (otherwise `register()` crashes the app — the server is not even asked; a failing
 * check, e.g. an older app without the plugin, counts as «no»); the server has the platform's keys.
 */
export async function isNativePushAvailable(deps: NativePushAvailabilityDeps = defaultAvailability): Promise<boolean> {
  const platform = deps.platform();
  if (!platform) return false;
  if (platform === 'android' && !(await deps.firebaseConfigured().catch(() => false))) return false;
  return deps.serverConfigured(platform);
}

export async function nativePushPermission(): Promise<NativePushPermission> {
  try {
    const { receive } = await PushNotifications.checkPermissions();
    return receive === 'granted' ? 'granted' : receive === 'denied' ? 'denied' : 'prompt';
  } catch {
    return 'denied';
  }
}

/** `register()` and the first `registration` / `registrationError` event after it. */
function requestDeviceToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const handles: Array<Promise<{ remove(): Promise<void> }>> = [];
    let settled = false;
    const finish = (error: Error | null, token?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      handles.forEach((handle) => void handle.then((h) => h.remove()).catch(() => {}));
      if (error) reject(error);
      else resolve(token as string);
    };
    const timer = setTimeout(() => finish(new Error('push registration timed out')), REGISTER_TIMEOUT_MS);
    handles.push(PushNotifications.addListener('registration', ({ value }) => finish(null, value)));
    handles.push(PushNotifications.addListener('registrationError', ({ error }) => finish(new Error(error || 'push registration failed'))));
    void Promise.all(handles)
      .then(() => PushNotifications.register())
      .catch((error: unknown) => finish(error instanceof Error ? error : new Error(String(error))));
  });
}

/**
 * Turns native push on for `userId` on this device. `prompt: false` (silent restore at start)
 * never shows the system permission dialog. Throws when the server refused the token.
 */
export async function registerNativePush(
  userId: string | null | undefined,
  opts: { prompt?: boolean } = {},
  availability: NativePushAvailabilityDeps = defaultAvailability,
): Promise<NativePushRegistration> {
  const platform = availability.platform();
  if (!platform || !(await isNativePushAvailable(availability))) return 'unavailable';

  let permission = await nativePushPermission();
  if (permission === 'prompt' && opts.prompt !== false) {
    const { receive } = await PushNotifications.requestPermissions();
    permission = receive === 'granted' ? 'granted' : 'denied';
  }
  if (permission !== 'granted') return 'denied';

  const token = await requestDeviceToken();
  const res = await fetch('/api/push/devices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, token }),
  });
  if (!res.ok) throw new Error(`push device registration failed: ${res.status}`);
  storageSet(TOKEN_KEY, token);
  setNativePushWanted(userId, true);
  return 'registered';
}

/** Turns native push off for `userId` on this device (the server forgets the token). */
export async function unregisterNativePush(userId: string | null | undefined): Promise<void> {
  setNativePushWanted(userId, false);
  const token = currentPushToken();
  if (!token) return;
  const res = await fetch('/api/push/devices', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) throw new Error(`push device removal failed: ${res.status}`);
}

export type PushHandoverDeps = {
  wanted(userId: string): boolean;
  /** The device token of the last registration on this phone (whoever registered it). */
  storedToken(): string | null;
  register(userId: string): Promise<NativePushRegistration>;
  /** `DELETE /api/push/devices {token}`; true when the server forgot the device. */
  release(token: string): Promise<boolean>;
  forgetToken(): void;
};

const defaultHandover: PushHandoverDeps = {
  wanted: (userId) => isNativePushWanted(userId),
  storedToken: currentPushToken,
  register: (userId) => registerNativePush(userId, { prompt: false }),
  release: async (token) => {
    const res = await fetch('/api/push/devices', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  },
  forgetToken: () => storageSet(TOKEN_KEY, null),
};

/**
 * At start and after every sign-in (`userId` changes) on this device:
 * - the user turned push on here → re-register (tokens rotate; the server moves the token to them);
 * - otherwise a token left by an earlier registration (another account on a shared phone, or a
 *   sign-out without connection) is released, so the previous owner's pushes stop coming here.
 * Errors are ignored: the next start tries again.
 */
export async function restoreNativePush(userId: string | null | undefined, deps: PushHandoverDeps = defaultHandover): Promise<void> {
  if (!userId) return;
  if (deps.wanted(userId)) {
    try {
      if ((await deps.register(userId)) === 'registered') return;
    } catch {}
  }
  const token = deps.storedToken();
  if (!token) return;
  try {
    if (await deps.release(token)) deps.forgetToken();
  } catch {}
}

type PushAction = Partial<Pick<ActionPerformed, 'actionId'>> & { notification?: { data?: unknown } };

/** Route of the app to open for a tap on a push: internal `data.link` → `toAppRoute`; otherwise null. */
export function pushActionRoute(action: PushAction | null | undefined): string | null {
  if (!action || action.actionId === 'dismiss') return null;
  const data = action.notification?.data;
  const link = data && typeof data === 'object' ? (data as { link?: unknown }).link : undefined;
  if (typeof link !== 'string' || !link.startsWith('/') || link.startsWith('//')) return null;
  return toAppRoute(link);
}

type ActionListen = (listener: (action: PushAction) => void) => Promise<{ remove(): Promise<void> }>;

const listenForActions: ActionListen = (listener) =>
  PushNotifications.addListener('pushNotificationActionPerformed', listener);

/**
 * Tap on a push → `navigate(toAppRoute(link))` (pass `router.push`: a full reload of a path
 * in Capacitor opens the root page). A tap that launched the app is delivered once the listener
 * is added. Returns the cleanup.
 */
export function installPushActionHandler(navigate: (path: string) => void, listen: ActionListen = listenForActions): () => void {
  let stopped = false;
  let handle: { remove(): Promise<void> } | null = null;
  void listen((action) => {
    const route = pushActionRoute(action);
    if (route) navigate(route);
  })
    .then((h) => {
      if (stopped) void h.remove();
      else handle = h;
    })
    .catch(() => {});
  return () => {
    stopped = true;
    if (handle) void handle.remove();
  };
}
