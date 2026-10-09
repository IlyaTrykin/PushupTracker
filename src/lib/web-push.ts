import { prisma } from '@/lib/prisma';
import { filterUsersByChannel, type NotificationEventType } from '@/lib/notification-preferences';

export type PushPayload = {
  title: string;
  body?: string;
  link?: string;
  tag?: string;
};

export type PushEventType = NotificationEventType;

export function getVapidPublicKey(): string {
  return (process.env.VAPID_PUBLIC_KEY || '').trim();
}

function getVapidConfig() {
  const publicKey = (process.env.VAPID_PUBLIC_KEY || '').trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
  const subject = (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim();
  return { publicKey, privateKey, subject };
}

export function isPushConfigured(): boolean {
  const c = getVapidConfig();
  return Boolean(c.publicKey && c.privateKey);
}

function getStatusCode(error: unknown) {
  if (typeof error === 'object' && error && 'statusCode' in error) {
    return Number((error as { statusCode?: unknown }).statusCode ?? 0);
  }
  return 0;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Таймаут одного запроса к push-сервису: медленный или «зависший» endpoint не держит обработчик.
export const PUSH_SEND_TIMEOUT_MS = 5000;

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('push send deadline exceeded')), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Отправляет push пользователям (с учётом NotificationPreference) параллельно, с таймаутом
 * 5 с на подписку. Удалённым (deletedAt) пользователям ничего не уходит. Ошибки не бросает.
 * В обработчиках API используйте `queueWebPushToUsers` — он не задерживает ответ.
 */
export async function sendWebPushToUsers(
  userIds: string[],
  payload: PushPayload,
  eventType?: PushEventType,
): Promise<void> {
  if (!userIds.length) return;
  if (!isPushConfigured()) return;

  const { publicKey, privateKey, subject } = getVapidConfig();
  const webPush = await import('web-push');
  webPush.setVapidDetails(subject, publicKey, privateKey);

  let allowedUserIds = Array.from(new Set(userIds));
  if (eventType) {
    allowedUserIds = await filterUsersByChannel(allowedUserIds, eventType, 'push');
  }

  if (!allowedUserIds.length) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: allowedUserIds }, isActive: true, user: { deletedAt: null } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (!subscriptions.length) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body || '',
    link: payload.link || '/',
    tag: payload.tag || 'pushup-general',
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await withDeadline(
          webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            body,
            { timeout: PUSH_SEND_TIMEOUT_MS },
          ),
          // timeout у web-push — таймаут простоя сокета; общий срок не даёт «капающему» ответу тянуть дольше
          PUSH_SEND_TIMEOUT_MS * 2,
        );
      } catch (e) {
        const code = getStatusCode(e);
        if (code === 404 || code === 410) {
          await prisma.pushSubscription.deleteMany({ where: { id: sub.id } }).catch(() => {});
        } else {
          console.error('WEB PUSH SEND ERROR:', getErrorMessage(e));
        }
      }
    }),
  );
}

/** Push в фоне: обработчик API не ждёт push-сервисы. Ошибки только в лог. */
export function queueWebPushToUsers(userIds: string[], payload: PushPayload, eventType?: PushEventType): void {
  if (!userIds.length) return;
  void sendWebPushToUsers(userIds, payload, eventType).catch((e) => {
    console.error('WEB PUSH QUEUE ERROR:', getErrorMessage(e));
  });
}
