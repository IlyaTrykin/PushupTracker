import { prisma } from '@/lib/prisma';

export type NotificationEventType =
  | 'friend_request'
  | 'challenge_invite'
  | 'challenge_rank_change'
  | 'friend_workout'
  | 'program_reminder';

export type NotificationChannel = 'push' | 'email';

export const NOTIFICATION_EVENT_DEFS: Array<{
  eventType: NotificationEventType;
  label: string;
  defaultPush: boolean;
  defaultEmail: boolean;
}> = [
  {
    eventType: 'friend_request',
    label: 'Запрос в друзья',
    defaultPush: true,
    defaultEmail: true,
  },
  {
    eventType: 'challenge_invite',
    label: 'Приглашение в челлендж',
    defaultPush: true,
    defaultEmail: true,
  },
  {
    eventType: 'challenge_rank_change',
    label: 'Смена позиции в челлендже',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'friend_workout',
    label: 'Новая тренировка друга',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'program_reminder',
    label: 'Напоминание о тренировке по программе',
    defaultPush: true,
    defaultEmail: false,
  },
];

const eventDefMap = new Map(NOTIFICATION_EVENT_DEFS.map((d) => [d.eventType, d]));

export function getDefaultFor(eventType: NotificationEventType) {
  return eventDefMap.get(eventType) || { defaultPush: true, defaultEmail: false, label: eventType };
}

export async function getResolvedPreferencesForUser(userId: string) {
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { eventType: true, pushEnabled: true, emailEnabled: true },
  });

  const byEvent = new Map(rows.map((r) => [r.eventType as NotificationEventType, r]));

  return NOTIFICATION_EVENT_DEFS.map((def) => {
    const row = byEvent.get(def.eventType);
    return {
      eventType: def.eventType,
      label: def.label,
      pushEnabled: row ? row.pushEnabled : def.defaultPush,
      emailEnabled: row ? row.emailEnabled : def.defaultEmail,
    };
  });
}

export async function filterUsersByChannel(
  userIds: string[],
  eventType: NotificationEventType,
  channel: NotificationChannel,
): Promise<string[]> {
  if (!userIds.length) return [];

  const uniqueUserIds = Array.from(new Set(userIds));
  const rows = await prisma.notificationPreference.findMany({
    where: {
      userId: { in: uniqueUserIds },
      eventType,
    },
    select: { userId: true, pushEnabled: true, emailEnabled: true },
  });

  const rowMap = new Map(rows.map((r) => [r.userId, r]));
  const def = getDefaultFor(eventType);

  return uniqueUserIds.filter((uid) => {
    const row = rowMap.get(uid);
    if (!row) return channel === 'push' ? def.defaultPush : def.defaultEmail;
    return channel === 'push' ? row.pushEnabled : row.emailEnabled;
  });
}

export async function isChannelEnabledForUser(
  userId: string,
  eventType: NotificationEventType,
  channel: NotificationChannel,
): Promise<boolean> {
  const arr = await filterUsersByChannel([userId], eventType, channel);
  return arr.includes(userId);
}
