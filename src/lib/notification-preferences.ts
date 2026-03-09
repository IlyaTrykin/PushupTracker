import { prisma } from '@/lib/prisma';

export type NotificationEventType =
  | 'friend_request'
  | 'challenge_invite'
  | 'challenge_rank_change'
  | 'friend_workout'
  | 'friend_reaction'
  | 'program_reminder'
  | 'admin_new_user_registered';

export type NotificationChannel = 'push' | 'email';

type NotificationEventDef = {
  eventType: NotificationEventType;
  label: string;
  defaultPush: boolean;
  defaultEmail: boolean;
  adminOnly?: boolean;
};

export const NOTIFICATION_EVENT_DEFS: NotificationEventDef[] = [
  {
    eventType: 'friend_request',
    label: 'Запрос в друзья',
    defaultPush: true,
    defaultEmail: true,
  },
  {
    eventType: 'challenge_invite',
    label: 'Приглашение в соревнование',
    defaultPush: true,
    defaultEmail: true,
  },
  {
    eventType: 'challenge_rank_change',
    label: 'Смена позиции в соревновании',
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
    eventType: 'friend_reaction',
    label: 'Реакция друга на тренировку',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'program_reminder',
    label: 'Напоминание о тренировке по программе',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'admin_new_user_registered',
    label: 'Новая регистрация пользователя',
    defaultPush: true,
    defaultEmail: true,
    adminOnly: true,
  },
];

const eventDefMap = new Map(NOTIFICATION_EVENT_DEFS.map((d) => [d.eventType, d]));

export function getDefaultFor(eventType: NotificationEventType): NotificationEventDef {
  return eventDefMap.get(eventType) || {
    eventType,
    label: eventType,
    defaultPush: true,
    defaultEmail: false,
  };
}

export async function getResolvedPreferencesForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  const availableDefs = NOTIFICATION_EVENT_DEFS.filter((def) => !def.adminOnly || user?.isAdmin);
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { eventType: true, pushEnabled: true, emailEnabled: true },
  });

  const byEvent = new Map(rows.map((r) => [r.eventType as NotificationEventType, r]));

  return availableDefs.map((def) => {
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
  const users = await prisma.user.findMany({
    where: { id: { in: uniqueUserIds } },
    select: { id: true, isAdmin: true },
  });
  const userMap = new Map(users.map((user) => [user.id, user]));
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
    if (def.adminOnly && !userMap.get(uid)?.isAdmin) return false;
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
