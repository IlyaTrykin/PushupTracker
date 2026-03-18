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

  let allowedUserIds = userIds;
  if (eventType) {
    allowedUserIds = await filterUsersByChannel(userIds, eventType, 'push');
  }

  if (!allowedUserIds.length) return;

  const subscriptions = await prisma.pushSubscription.findMany({
    where: { userId: { in: allowedUserIds }, isActive: true },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });

  if (!subscriptions.length) return;

  const body = JSON.stringify({
    title: payload.title,
    body: payload.body || '',
    link: payload.link || '/',
    tag: payload.tag || 'pushup-general',
  });

  for (const sub of subscriptions) {
    try {
      await webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
      );
    } catch (e) {
      const code = getStatusCode(e);
      if (code === 404 || code === 410) {
        await prisma.pushSubscription.deleteMany({ where: { id: sub.id } }).catch(() => {});
      } else {
        console.error('WEB PUSH SEND ERROR:', getErrorMessage(e));
      }
    }
  }
}
