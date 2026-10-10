import { prisma } from '@/lib/prisma';

export type NotificationEventType =
  | 'friend_request'
  | 'challenge_invite'
  | 'challenge_rank_change'
  | 'group_join_request'
  | 'group_join_request_approved'
  | 'group_join_request_rejected'
  | 'friend_workout'
  | 'friend_reaction'
  | 'program_reminder'
  | 'admin_new_user_registered'
  | 'daily_goal_reminder'
  | 'weekly_league'
  | 'weekly_summary'
  | 'friend_achievement'
  | 'group_goal_completed';

export type NotificationChannel = 'push' | 'email' | 'telegram';

export type ChannelPreference = { push: boolean; email: boolean; telegram: boolean };

export type NotificationEventDef = {
  eventType: NotificationEventType;
  label: string;
  defaultPush: boolean;
  defaultEmail: boolean;
  /** Telegram is opt-in per event (matches `NotificationPreference.telegramEnabled @default(false)`). */
  defaultTelegram?: boolean;
  adminOnly?: boolean;
};

type StoredPreference = { pushEnabled: boolean; emailEnabled: boolean; telegramEnabled: boolean };

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
    eventType: 'group_join_request',
    label: 'Новая заявка в группу',
    defaultPush: true,
    defaultEmail: true,
  },
  {
    eventType: 'group_join_request_approved',
    label: 'Заявка в группу одобрена',
    defaultPush: true,
    defaultEmail: true,
  },
  {
    eventType: 'group_join_request_rejected',
    label: 'Заявка в группу отклонена',
    defaultPush: true,
    defaultEmail: true,
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
  {
    eventType: 'daily_goal_reminder',
    label: 'Напоминание о цели дня',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'weekly_league',
    label: 'Итог лиги недели',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'weekly_summary',
    label: 'Итоги недели',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'friend_achievement',
    label: 'Рекорды и достижения друзей',
    defaultPush: true,
    defaultEmail: false,
  },
  {
    eventType: 'group_goal_completed',
    label: 'Цель группы выполнена',
    defaultPush: true,
    defaultEmail: false,
  },
];

export function isNotificationEventType(value: unknown): value is NotificationEventType {
  return typeof value === 'string' && NOTIFICATION_EVENT_DEFS.some((d) => d.eventType === value);
}

const eventDefMap = new Map(NOTIFICATION_EVENT_DEFS.map((d) => [d.eventType, d]));

export function getDefaultFor(eventType: NotificationEventType): NotificationEventDef {
  return eventDefMap.get(eventType) || {
    eventType,
    label: eventType,
    defaultPush: true,
    defaultEmail: false,
  };
}

/**
 * Channels for one user and event: the stored row if any, otherwise the event defaults.
 * `null` — the event is admin-only and the user is not an admin (nothing at all is sent).
 */
export function resolveChannelPreference(
  def: NotificationEventDef,
  row: StoredPreference | null | undefined,
  isAdmin: boolean,
): ChannelPreference | null {
  if (def.adminOnly && !isAdmin) return null;
  if (!row) return { push: def.defaultPush, email: def.defaultEmail, telegram: Boolean(def.defaultTelegram) };
  return { push: row.pushEnabled, email: row.emailEnabled, telegram: row.telegramEnabled };
}

/** Telegram channel exists only when the bot token is configured (T12). */
export function isTelegramConfigured(): boolean {
  return Boolean((process.env.TELEGRAM_BOT_TOKEN || '').trim());
}

export async function getResolvedPreferencesForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isAdmin: true },
  });
  const availableDefs = NOTIFICATION_EVENT_DEFS.filter((def) => !def.adminOnly || user?.isAdmin);
  const rows = await prisma.notificationPreference.findMany({
    where: { userId },
    select: { eventType: true, pushEnabled: true, emailEnabled: true, telegramEnabled: true },
  });

  const byEvent = new Map(rows.map((r) => [r.eventType as NotificationEventType, r]));

  return availableDefs.map((def) => {
    const channels = resolveChannelPreference(def, byEvent.get(def.eventType), true)!;
    return {
      eventType: def.eventType,
      label: def.label,
      pushEnabled: channels.push,
      emailEnabled: channels.email,
      telegramEnabled: channels.telegram,
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
    select: { userId: true, pushEnabled: true, emailEnabled: true, telegramEnabled: true },
  });

  const rowMap = new Map(rows.map((r) => [r.userId, r]));
  const def = getDefaultFor(eventType);

  return uniqueUserIds.filter((uid) => {
    const channels = resolveChannelPreference(def, rowMap.get(uid), Boolean(userMap.get(uid)?.isAdmin));
    return Boolean(channels?.[channel]);
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
