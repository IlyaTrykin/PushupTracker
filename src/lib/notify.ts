/**
 * One way to notify users: in-app row + push + email + Telegram, according to
 * `NotificationPreference`, with the text built in each recipient's language.
 *
 * Scheduled notifications first claim a dedupe key in `NotificationDispatch`
 * (`claimDispatch`), so two parallel ticks or requests send at most once.
 */
import type { NotificationEventType, ChannelPreference } from '@/lib/notification-preferences';
import type { PushPayload } from '@/lib/web-push';
import { exerciseLabel, isTimedExercise } from '@/lib/exercises';
import { formatWorkoutValue } from '@/lib/exercise-metrics';
import { programLabel, type ProgramLabelSource } from '@/lib/program-plan';

export type NotifyEvent = NotificationEventType;
export type NotifyLocale = 'ru' | 'en';
export type LocalizedMessage = { title: string; body?: string; link?: string };

export type NotifyOptions = {
  /** Claimed in `NotificationDispatch` per recipient; already claimed → that recipient is skipped. */
  dedupeKey?: (userId: string) => string;
  /** Push tag (one visible push per tag on the device). Default `pushup-<event>`. */
  tag?: string;
  /** Write the in-app notification. Default true. */
  inApp?: boolean;
  /** `Notification.type` of the in-app row when it differs from the event (e.g. `program_missed_1h`). */
  type?: string;
  /** Only the in-app row: no push / email / Telegram (events without their own channel settings). */
  inAppOnly?: boolean;
};

export type NotifyRecipient = {
  id: string;
  locale: NotifyLocale;
  email: string | null;
  telegramChatId: string | null;
  channels: ChannelPreference;
};

export type InAppRow = { userId: string; type: string; title: string; body: string | null; link: string | null };

export type NotifyDeps = {
  /** Inserts the key; throws Prisma P2002 when it already exists. */
  insertDispatch(key: string): Promise<void>;
  /** Active (not deleted) users among `userIds` with their channels for `event`. */
  loadRecipients(userIds: string[], event: NotifyEvent): Promise<NotifyRecipient[]>;
  createInApp(rows: InAppRow[]): Promise<void>;
  sendPush(userId: string, payload: PushPayload): Promise<void>;
  sendEmail(to: string, message: LocalizedMessage, locale: NotifyLocale): Promise<void>;
  sendTelegram(chatId: string, message: LocalizedMessage, locale: NotifyLocale): Promise<void>;
  /** Runs delivery without holding the caller (API response, scheduler tick). */
  defer(task: () => Promise<void>): void;
  logError(label: string, error: unknown): void;
};

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export function toNotifyLocale(language: string | null | undefined): NotifyLocale {
  return language === 'en' ? 'en' : 'ru';
}

export function telegramText(message: LocalizedMessage, appUrl: string): string {
  const link = message.link ? `${appUrl.replace(/\/+$/, '')}${message.link.startsWith('/') ? '' : '/'}${message.link}` : '';
  return [message.title, message.body, link].filter(Boolean).join('\n');
}

export function createNotifier(deps: NotifyDeps) {
  async function claimDispatch(key: string): Promise<boolean> {
    try {
      await deps.insertDispatch(key);
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  async function notifyUsers(
    userIds: string[],
    event: NotifyEvent,
    build: (locale: NotifyLocale, userId: string) => LocalizedMessage,
    opts: NotifyOptions = {},
  ): Promise<void> {
    const ids = Array.from(new Set(userIds.filter(Boolean)));
    if (!ids.length) return;

    let recipients: NotifyRecipient[];
    try {
      recipients = await deps.loadRecipients(ids, event);
    } catch (error) {
      deps.logError('NOTIFY RECIPIENTS ERROR', error);
      return;
    }

    const deliveries: Array<{ recipient: NotifyRecipient; message: LocalizedMessage }> = [];
    for (const recipient of recipients) {
      if (opts.dedupeKey) {
        try {
          if (!(await claimDispatch(opts.dedupeKey(recipient.id)))) continue;
        } catch (error) {
          deps.logError('NOTIFY DEDUPE ERROR', error);
          continue;
        }
      }
      try {
        deliveries.push({ recipient, message: build(recipient.locale, recipient.id) });
      } catch (error) {
        deps.logError('NOTIFY BUILD ERROR', error);
      }
    }
    if (!deliveries.length) return;

    if (opts.inApp !== false) {
      try {
        await deps.createInApp(deliveries.map(({ recipient, message }) => ({
          userId: recipient.id,
          type: opts.type || event,
          title: message.title,
          body: message.body ?? null,
          link: message.link ?? null,
        })));
      } catch (error) {
        deps.logError('NOTIFY IN-APP ERROR', error);
      }
    }

    if (opts.inAppOnly) return;

    const tag = opts.tag || `pushup-${event}`;
    const attempt = async (label: string, send: () => Promise<void>) => {
      try {
        await send();
      } catch (error) {
        deps.logError(label, error);
      }
    };

    deps.defer(async () => {
      await Promise.all(deliveries.flatMap(({ recipient, message }) => {
        const tasks: Array<Promise<void>> = [];
        if (recipient.channels.push) {
          tasks.push(attempt('NOTIFY PUSH ERROR', () => deps.sendPush(recipient.id, { ...message, tag })));
        }
        if (recipient.channels.email && recipient.email) {
          const to = recipient.email;
          tasks.push(attempt('NOTIFY EMAIL ERROR', () => deps.sendEmail(to, message, recipient.locale)));
        }
        if (recipient.channels.telegram && recipient.telegramChatId) {
          const chatId = recipient.telegramChatId;
          tasks.push(attempt('NOTIFY TELEGRAM ERROR', () => deps.sendTelegram(chatId, message, recipient.locale)));
        }
        return tasks;
      }));
    });
  }

  return { claimDispatch, notifyUsers };
}

export type PushChannels = {
  web(userIds: string[], payload: PushPayload): Promise<unknown>;
  native(userIds: string[], payload: PushPayload): Promise<unknown>;
  logError(label: string, error: unknown): void;
};

/**
 * The push channel of `notifyUsers`: web push (browsers, PWA) and native push (iOS / Android apps)
 * in parallel with the same payload. Preferences are already applied; one transport failing does
 * not stop the other. Without VAPID / APNs / FCM keys the respective transport sends nothing.
 */
export function createPushSender(channels: PushChannels): NotifyDeps['sendPush'] {
  return async (userId, payload) => {
    await Promise.all([
      channels.web([userId], payload).catch((error) => channels.logError('NOTIFY WEB PUSH ERROR', error)),
      channels.native([userId], payload).catch((error) => channels.logError('NOTIFY NATIVE PUSH ERROR', error)),
    ]);
  };
}

// ---------------------------------------------------------------------------
// Localized message builders (pure). Exercise names always come from the catalog.
// ---------------------------------------------------------------------------

/** Catalog exercise name for running text: «отжимания» / «push-ups». */
export function exerciseName(exerciseType: string, locale: NotifyLocale): string {
  return exerciseLabel(exerciseType, locale).toLowerCase();
}

/** «30», «60 сек» / «60 s», «12 × 16 кг» / «12 × 16 kg». */
export function formatNotifyValue(value: number, exerciseType: string, locale: NotifyLocale, loadKg?: number | null): string {
  let out = isTimedExercise(exerciseType) ? `${value} ${locale === 'en' ? 's' : 'сек'}` : String(value);
  if (loadKg != null) out += ` × ${loadKg} ${locale === 'en' ? 'kg' : 'кг'}`;
  return out;
}

export function friendWorkoutMessage(
  locale: NotifyLocale,
  args: { username: string; exerciseType: string; value: number; loadKg?: number | null },
): LocalizedMessage {
  const what = `${exerciseLabel(args.exerciseType, locale)} — ${formatNotifyValue(args.value, args.exerciseType, locale, args.loadKg)}`;
  return locale === 'en'
    ? { title: 'Friend workout', body: `${args.username}: ${what}`, link: '/friends' }
    : { title: 'Новая тренировка друга', body: `${args.username}: ${what}`, link: '/friends' };
}

export function challengeRankMessage(
  locale: NotifyLocale,
  args: { challengeId: string; challengeName: string; previousRank: number; rank: number },
): LocalizedMessage {
  const up = args.rank < args.previousRank;
  const link = `/challenges/${args.challengeId}`;
  return locale === 'en'
    ? { title: 'Your challenge place changed', body: `${args.challengeName}: ${args.previousRank} → ${args.rank} (${up ? 'moved up' : 'moved down'})`, link }
    : { title: 'Изменилось место в соревновании', body: `${args.challengeName}: ${args.previousRank} → ${args.rank} (${up ? 'поднялись' : 'опустились'})`, link };
}

export function challengeInviteMessage(
  locale: NotifyLocale,
  args: { challengeId: string; challengeName: string; inviterUsername: string },
): LocalizedMessage {
  const link = `/challenges?invite=${encodeURIComponent(args.challengeId)}`;
  return locale === 'en'
    ? { title: 'Challenge invitation', body: `${args.inviterUsername} invited you to challenge: ${args.challengeName}`, link }
    : { title: 'Приглашение в соревнование', body: `${args.inviterUsername} пригласил вас в соревнование: ${args.challengeName}`, link };
}

export function challengeResponseMessage(
  locale: NotifyLocale,
  args: { challengeId: string; challengeName: string; username: string; accepted: boolean },
): LocalizedMessage {
  const link = `/challenges/${args.challengeId}`;
  if (locale === 'en') {
    return args.accepted
      ? { title: 'Invitation accepted', body: `${args.username} accepted the challenge invitation: ${args.challengeName}`, link }
      : { title: 'Invitation declined', body: `${args.username} declined the challenge invitation: ${args.challengeName}`, link };
  }
  return args.accepted
    ? { title: 'Приглашение принято', body: `${args.username} принял приглашение в соревнование: ${args.challengeName}`, link }
    : { title: 'Приглашение отклонено', body: `${args.username} отклонил приглашение в соревнование: ${args.challengeName}`, link };
}

// --- Friends and groups (T04 decides who and when; these only word it) ---

export function friendRequestMessage(locale: NotifyLocale, args: { username: string }): LocalizedMessage {
  return locale === 'en'
    ? { title: 'New friend request', body: `${args.username} sent you a friend request`, link: '/friends' }
    : { title: 'Новый запрос в друзья', body: `${args.username} отправил вам запрос в друзья`, link: '/friends' };
}

export function friendRequestAcceptedMessage(locale: NotifyLocale, args: { username: string }): LocalizedMessage {
  return locale === 'en'
    ? { title: 'Friend request accepted', body: `${args.username} accepted your friend request`, link: '/friends' }
    : { title: 'Запрос в друзья принят', body: `${args.username} принял ваш запрос в друзья`, link: '/friends' };
}

export function inviteJoinedMessage(locale: NotifyLocale, args: { username: string }): LocalizedMessage {
  return locale === 'en'
    ? { title: 'Your friend joined', body: `${args.username} signed up with your invite link — you are now friends`, link: '/friends' }
    : { title: 'Друг присоединился', body: `${args.username} зарегистрировался по вашей ссылке — теперь вы друзья`, link: '/friends' };
}

export type ReactedWorkout = {
  exerciseType: string;
  reps: number;
  loadKg?: number | null;
  durationSeconds?: number | null;
};

/** «ann 🔥 на вашу тренировку: Планка — 60 сек» (cardio: distance, time and pace). */
export function friendReactionMessage(
  locale: NotifyLocale,
  args: { username: string; emoji: string; workout: ReactedWorkout },
): LocalizedMessage {
  const { workout } = args;
  const what = `${exerciseLabel(workout.exerciseType, locale)} — ${formatWorkoutValue({ ...workout, loadKg: workout.loadKg ?? null }, locale, false)}`;
  return locale === 'en'
    ? { title: 'New reaction to your workout', body: `${args.username} ${args.emoji} on your workout: ${what}`, link: '/dashboard' }
    : { title: 'Новая реакция на тренировку', body: `${args.username} ${args.emoji} на вашу тренировку: ${what}`, link: '/dashboard' };
}

export function groupJoinRequestMessage(
  locale: NotifyLocale,
  args: { username: string; groupId: string; groupName: string },
): LocalizedMessage {
  const link = `/groups/${args.groupId}`;
  return locale === 'en'
    ? { title: 'New request to join a group', body: `${args.username} wants to join ${args.groupName}`, link }
    : { title: 'Новая заявка в группу', body: `${args.username} хочет вступить в группу ${args.groupName}`, link };
}

export function groupJoinResolvedMessage(
  locale: NotifyLocale,
  args: { groupId: string; groupName: string; approved: boolean },
): LocalizedMessage {
  const link = `/groups/${args.groupId}`;
  if (locale === 'en') {
    return args.approved
      ? { title: 'Join request approved', body: `You joined ${args.groupName}`, link }
      : { title: 'Join request declined', body: `Your request to join ${args.groupName} was declined`, link };
  }
  return args.approved
    ? { title: 'Заявка в группу одобрена', body: `Вы вступили в группу ${args.groupName}`, link }
    : { title: 'Заявка в группу отклонена', body: `Вступление в группу ${args.groupName} отклонено`, link };
}

/** What a program notice names: the program label (`programLabel`) — exercise, kettlebell weight, circuit plan. */
export type ProgramNoticeSource = ProgramLabelSource;

/** «Скоро тренировка»: one or several program sessions due around now. */
export function programReminderMessage(
  locale: NotifyLocale,
  sessions: Array<ProgramNoticeSource & { id: string; scheduledAt: Date }>,
  now: Date,
): LocalizedMessage {
  const first = sessions[0];
  if (sessions.length > 1) {
    const names = Array.from(new Set(sessions.map((s) => programLabel(s, locale)))).join(', ');
    return locale === 'en'
      ? { title: 'Workout reminder', body: `Program workouts coming up: ${names}`, link: '/program' }
      : { title: 'Напоминание о тренировке', body: `Скоро тренировки по программе: ${names}`, link: '/program' };
  }
  const minutes = Math.round((first.scheduledAt.getTime() - now.getTime()) / 60000);
  const name = programLabel(first, locale);
  const link = `/program/session/${first.id}`;
  if (locale === 'en') {
    return {
      title: 'Workout reminder',
      body: minutes > 0 ? `Program workout in ${minutes} min: ${name}` : `Time for your program workout: ${name}`,
      link,
    };
  }
  return {
    title: 'Напоминание о тренировке',
    body: minutes > 0 ? `Через ${minutes} мин тренировка по программе: ${name}` : `Пора начинать тренировку по программе: ${name}`,
    link,
  };
}

export type MissedSessionKind = 'missed_1h' | 'missed_24h' | 'stop_warning';

export function programMissedMessage(
  locale: NotifyLocale,
  kind: MissedSessionKind,
  args: ProgramNoticeSource & { sessionId: string },
): LocalizedMessage {
  const link = `/program/session/${args.sessionId}`;
  const name = programLabel(args, locale);
  if (locale === 'en') {
    if (kind === 'missed_1h') return { title: 'Missed program workout', body: `An hour has passed since your planned workout (${name}). You can still do it now.`, link };
    if (kind === 'missed_24h') return { title: 'Program workout not done', body: `A day has passed since your planned workout (${name}).`, link };
    return { title: 'Your program stops in a week', body: 'If the break exceeds 2 weeks, the program will stop automatically.', link };
  }
  if (kind === 'missed_1h') return { title: 'Пропущена плановая тренировка', body: `Прошёл 1 час после плановой тренировки (${name}). Её можно выполнить сейчас.`, link };
  if (kind === 'missed_24h') return { title: 'Тренировка по программе не выполнена', body: `Прошли сутки после плановой тренировки (${name}).`, link };
  return { title: 'Программа будет прервана через неделю', body: 'Если пропуск плановой тренировки превысит 2 недели, программа автоматически прервётся.', link };
}

export function programStoppedMessage(locale: NotifyLocale, args: ProgramNoticeSource & { programId: string }): LocalizedMessage {
  const link = `/program?stoppedProgram=${encodeURIComponent(args.programId)}`;
  const name = programLabel(args, locale);
  return locale === 'en'
    ? { title: 'Program stopped', body: `Your program «${name}» was stopped after a break longer than 2 weeks. Create a new one when you are ready.`, link }
    : { title: 'Программа прервана', body: `Программа «${name}» прервана из-за пропуска более 2 недель. Создайте новую, когда будете готовы.`, link };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const prismaDeps: NotifyDeps = {
  insertDispatch: async (key) => {
    const { prisma } = await import('@/lib/prisma');
    // skipDuplicates instead of create: a taken key is the normal case and must not be logged as a Prisma error.
    const { count } = await prisma.notificationDispatch.createMany({ data: [{ key }], skipDuplicates: true });
    if (count === 0) throw Object.assign(new Error(`Dispatch key already claimed: ${key}`), { code: 'P2002' });
  },
  loadRecipients: async (userIds, event) => {
    const { prisma } = await import('@/lib/prisma');
    const { getDefaultFor, isTelegramConfigured, resolveChannelPreference } = await import('@/lib/notification-preferences');
    const [users, rows] = await Promise.all([
      prisma.user.findMany({
        where: { id: { in: userIds }, deletedAt: null },
        select: { id: true, language: true, email: true, isAdmin: true, telegramChatId: true },
      }),
      prisma.notificationPreference.findMany({
        where: { userId: { in: userIds }, eventType: event },
        select: { userId: true, pushEnabled: true, emailEnabled: true, telegramEnabled: true },
      }),
    ]);
    const rowByUser = new Map(rows.map((row) => [row.userId, row]));
    const def = getDefaultFor(event);
    const telegramReady = isTelegramConfigured();
    return users.flatMap((user) => {
      const channels = resolveChannelPreference(def, rowByUser.get(user.id), user.isAdmin);
      if (!channels) return [];
      return [{
        id: user.id,
        locale: toNotifyLocale(user.language),
        email: user.email || null,
        telegramChatId: telegramReady ? user.telegramChatId : null,
        channels,
      }];
    });
  },
  createInApp: async (rows) => {
    const { prisma } = await import('@/lib/prisma');
    await prisma.notification.createMany({ data: rows });
  },
  // Preferences are already applied by `loadRecipients`.
  sendPush: createPushSender({
    web: async (userIds, payload) => {
      const { sendWebPushToUsers } = await import('@/lib/web-push');
      await sendWebPushToUsers(userIds, payload);
    },
    native: async (userIds, payload) => {
      const { sendNativePushToUsers } = await import('@/lib/native-push');
      await sendNativePushToUsers(userIds, payload);
    },
    logError: (label, error) => {
      console.error(`${label}:`, errorText(error));
    },
  }),
  sendEmail: async (to, message, locale) => {
    const { sendNotificationEmail } = await import('@/lib/notification-email');
    await sendNotificationEmail(to, message, locale);
  },
  sendTelegram: async (chatId, message) => {
    const { sendTelegramMessage } = await import('@/lib/telegram/api');
    await sendTelegramMessage(chatId, telegramText(message, process.env.APP_URL || ''));
  },
  defer: (task) => {
    void task().catch((error) => console.error('NOTIFY DELIVERY ERROR:', errorText(error)));
  },
  logError: (label, error) => {
    console.error(`${label}:`, errorText(error));
  },
};

const defaultNotifier = createNotifier(prismaDeps);

/** Insert `key` into `NotificationDispatch`; `false` when it was already claimed (P2002). */
export const claimDispatch = defaultNotifier.claimDispatch;

/**
 * In-app (awaited) + push / email / Telegram (in the background) for each user by
 * `NotificationPreference`. Channel errors are logged, never thrown.
 */
export const notifyUsers = defaultNotifier.notifyUsers;
