/**
 * One incoming Telegram update → at most one reply (plus notices to other chats). Linking by
 * `/start <code>`, `/stop`, `/help`, `/today` and workout messages (see `parse.ts`), written
 * through `createWorkoutForUser(…, { source: 'telegram' })`.
 *
 * Linking never moves a chat from one account to another silently: `/start <code>` in a chat
 * linked to someone else asks for `/start <code> confirm`; after it the previous account gets an
 * in-app «Telegram отключён», and a chat replaced by a new one is told it is disconnected.
 *
 * Only private chats are served; other update kinds are ignored. Any error while handling an
 * update is logged and answered with «Не получилось, попробуй ещё раз».
 */
import { dayKeyInZone, dayKeyToDbDate, normalizeTimeZone, type DayKey } from '../calendar-day';
import { getExercise } from '../exercises';
import { toNotifyLocale, type NotifyLocale } from '../notify';
import { WorkoutCreateError } from '../workout-create';
import { fillTelegramText, telegramMessages } from '../../i18n/messages/features/telegram';
import { isParsedCommand, parseWorkoutMessage, type ParsedWorkout } from './parse';
import { helpReply, needWeightReply, replyPoints, todayReply, workoutErrorReply, workoutRecordedReply, type ReplyGoal, type ReplyWorkout } from './replies';

/** Messages one chat may send per minute; the rest are dropped silently. */
export const TELEGRAM_CHAT_RATE_LIMIT = 20;
export const TELEGRAM_CHAT_RATE_WINDOW_SECONDS = 60;
/** Second word of `/start <code> confirm`: move a chat linked to another account. */
export const LINK_CONFIRM_WORD = 'confirm';

export type BotNotice = { chatId: string; text: string };
export type BotReply = {
  chatId: string;
  text: string;
  /** One-time reply keyboard (each button sends its text). */
  buttons?: string[];
  /** Hide a reply keyboard sent earlier (after the confirmation is answered). */
  removeKeyboard?: boolean;
  /** Messages to other chats (e.g. the chat an account was moved away from). */
  notices?: BotNotice[];
};

type IncomingMessage = {
  chatId: string;
  messageId: number | null;
  text: string;
  languageCode: string;
};

export type LinkedUser = {
  id: string;
  username: string;
  language: string;
  timeZone: string;
  favoriteExercises: string[];
  dailyGoalPoints: number | null;
};

export type TelegramBotDeps = {
  hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean }>;
  /** The active (not deleted) account linked to the chat. */
  findUserByChat(chatId: string): Promise<LinkedUser | null>;
  /** An unexpired code of an active account. */
  findLinkCode(code: string, now: Date): Promise<{ userId: string; username: string } | null>;
  /**
   * Atomically: spends the code, takes the chat from its owner if that is still `expectedOwnerId`,
   * links it to `userId` and returns the chat the user had before. `null` — the code is gone or
   * the chat's owner changed meanwhile (nothing is changed).
   */
  linkChat(args: { code: string; userId: string; chatId: string; expectedOwnerId: string | null; now: Date }): Promise<{ previousChatId: string | null } | null>;
  unlinkChat(userId: string): Promise<void>;
  loadTodayWorkouts(userId: string, day: DayKey): Promise<ReplyWorkout[]>;
  /** `createWorkoutForUser(…, { source: 'telegram' })`; throws `WorkoutCreateError` on invalid input. */
  createWorkout(user: LinkedUser, parsed: ParsedWorkout, clientRequestId: string | undefined, now: Date): Promise<ReplyWorkout>;
  /** In-app «Telegram отключён» to the account a chat was moved away from. */
  notifyChatTakenOver(userId: string): Promise<void>;
  logError(label: string, error: unknown): void;
  appUrl(): string;
};

/** The private-chat text message of an update, or null for anything else. */
export function readIncomingMessage(update: unknown): IncomingMessage | null {
  if (!update || typeof update !== 'object') return null;
  const message = (update as { message?: unknown }).message;
  if (!message || typeof message !== 'object') return null;
  const m = message as {
    message_id?: unknown;
    text?: unknown;
    chat?: { id?: unknown; type?: unknown };
    from?: { language_code?: unknown; is_bot?: unknown };
  };
  if (m.chat?.type !== 'private' || m.from?.is_bot === true) return null;
  const rawId = m.chat.id;
  if (!(typeof rawId === 'number' && Number.isSafeInteger(rawId)) && !(typeof rawId === 'string' && /^-?\d{1,20}$/.test(rawId))) return null;
  return {
    chatId: String(rawId),
    messageId: typeof m.message_id === 'number' && Number.isSafeInteger(m.message_id) ? m.message_id : null,
    text: typeof m.text === 'string' ? m.text.slice(0, 500) : '',
    languageCode: typeof m.from?.language_code === 'string' ? m.from.language_code : '',
  };
}

/** Language of a chat not linked to an account: from the Telegram client, Russian by default. */
function guestLocale(message: IncomingMessage): NotifyLocale {
  return message.languageCode.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

function botText(locale: NotifyLocale) {
  return telegramMessages[locale].bot;
}

/** Раздел профиля, где подключают Telegram («Уведомления», R14.1). */
const TELEGRAM_PROFILE_PATH = '/profile?section=notifications';

/** The in-app row «Telegram отключён» for the account a chat was moved away from (own type, no settings). */
export function telegramUnlinkedNotification(userId: string, locale: NotifyLocale) {
  const text = botText(locale);
  return { userId, type: 'telegram_unlinked', title: text.unlinkedNoticeTitle, body: text.unlinkedNoticeBody, link: TELEGRAM_PROFILE_PATH };
}

/** `/start <code>` or `/start <code> confirm`. */
function readStartArg(arg: string): { code: string; confirmed: boolean } {
  const [code, flag] = arg.split(/\s+/);
  return { code, confirmed: flag?.toLowerCase() === LINK_CONFIRM_WORD };
}

export function createTelegramBot(deps: TelegramBotDeps) {
  const profileUrl = () => `${deps.appUrl().replace(/\/+$/, '')}${TELEGRAM_PROFILE_PATH}`;

  function today(user: LinkedUser, now: Date): DayKey {
    return dayKeyInZone(now, normalizeTimeZone(user.timeZone));
  }

  function goalOf(user: LinkedUser, workouts: ReplyWorkout[]): ReplyGoal {
    return user.dailyGoalPoints ? { done: replyPoints(workouts), goal: user.dailyGoalPoints } : null;
  }

  async function link(message: IncomingMessage, arg: string, now: Date): Promise<BotReply> {
    const { chatId } = message;
    const { code, confirmed } = readStartArg(arg);
    const invalid = (): BotReply => ({
      chatId,
      text: fillTelegramText(botText(guestLocale(message)).linkInvalid, { url: profileUrl() }),
      removeKeyboard: true,
    });

    const target = await deps.findLinkCode(code, now);
    if (!target) return invalid();
    const owner = await deps.findUserByChat(chatId);
    const takingOver = owner !== null && owner.id !== target.userId;

    if (takingOver && !confirmed) {
      // The person in this chat uses `owner`'s account: ask in their language, keep the code.
      const command = `/start ${code} ${LINK_CONFIRM_WORD}`;
      const text = fillTelegramText(botText(toNotifyLocale(owner.language)).linkConfirm, {
        current: owner.username,
        next: target.username,
        command,
      });
      return { chatId, text, buttons: [command] };
    }

    const result = await deps.linkChat({ code, userId: target.userId, chatId, expectedOwnerId: owner?.id ?? null, now });
    if (!result) return invalid();
    const user = await deps.findUserByChat(chatId);
    if (!user) return invalid();
    if (takingOver) {
      // The chat is already moved: a failed notice must not turn «linked» into an error.
      try {
        await deps.notifyChatTakenOver(owner.id);
      } catch (error) {
        deps.logError('TELEGRAM UNLINK NOTICE ERROR', error);
      }
    }

    const locale = toNotifyLocale(user.language);
    const lines = [fillTelegramText(botText(locale).linked, { username: user.username })];
    if (takingOver) lines.push(fillTelegramText(botText(locale).linkMoved, { previous: owner.username }));
    const reply: BotReply = { chatId, text: `${lines.join('\n')}\n\n${helpReply(locale, user.favoriteExercises)}`, removeKeyboard: true };
    if (result.previousChatId && result.previousChatId !== chatId) {
      reply.notices = [{
        chatId: result.previousChatId,
        text: fillTelegramText(botText(locale).unlinkedOtherChat, { username: user.username }),
      }];
    }
    return reply;
  }

  async function recordWorkout(user: LinkedUser, parsed: ParsedWorkout, message: IncomingMessage, now: Date): Promise<string> {
    const locale = toNotifyLocale(user.language);
    if (getExercise(parsed.exerciseType).load && parsed.loadKg === undefined) {
      return needWeightReply(locale, parsed.exerciseType, parsed.value);
    }
    // Telegram re-delivers an update when the webhook fails: the same message is recorded once.
    const clientRequestId = message.messageId !== null ? `tg:${message.chatId}:${message.messageId}` : undefined;
    let workout: ReplyWorkout;
    try {
      workout = await deps.createWorkout(user, parsed, clientRequestId, now);
    } catch (error) {
      if (error instanceof WorkoutCreateError) return workoutErrorReply(locale, error.code);
      throw error;
    }
    const goal = user.dailyGoalPoints ? goalOf(user, await deps.loadTodayWorkouts(user.id, today(user, now))) : null;
    return workoutRecordedReply(locale, workout, goal);
  }

  async function handle(message: IncomingMessage, now: Date, setLocale: (locale: NotifyLocale) => void): Promise<BotReply | null> {
    const { chatId } = message;
    const limit = await deps.hitRateLimit(`telegram-chat:${chatId}`, TELEGRAM_CHAT_RATE_LIMIT, TELEGRAM_CHAT_RATE_WINDOW_SECONDS);
    if (!limit.ok) return null;

    const reply = (text: string): BotReply => ({ chatId, text });
    const parsed = parseWorkoutMessage(message.text, []);
    if (parsed && isParsedCommand(parsed) && parsed.command === 'start' && parsed.arg) {
      return link(message, parsed.arg, now);
    }

    const user = await deps.findUserByChat(chatId);
    if (!user) return reply(fillTelegramText(botText(guestLocale(message)).notLinked, { url: profileUrl() }));
    const locale = toNotifyLocale(user.language);
    setLocale(locale);

    // Re-parse with the user's favourites: a bare number goes to their first favourite exercise.
    const own = parseWorkoutMessage(message.text, user.favoriteExercises);
    if (!own) return reply(botText(locale).unknown);

    if (isParsedCommand(own)) {
      switch (own.command) {
        case 'stop':
          await deps.unlinkChat(user.id);
          return reply(botText(locale).unlinked);
        case 'today': {
          const workouts = await deps.loadTodayWorkouts(user.id, today(user, now));
          return reply(todayReply(locale, workouts, goalOf(user, workouts)));
        }
        case 'start':
        case 'help':
          return reply(helpReply(locale, user.favoriteExercises));
        default:
          return reply(botText(locale).unknown);
      }
    }

    return reply(await recordWorkout(user, own, message, now));
  }

  /** Handles one update; returns the reply to send, or null (ignored, rate-limited). */
  async function handleTelegramUpdate(update: unknown, now: Date = new Date()): Promise<BotReply | null> {
    const message = readIncomingMessage(update);
    if (!message) return null;
    let locale = guestLocale(message);
    try {
      return await handle(message, now, (next) => {
        locale = next;
      });
    } catch (error) {
      deps.logError('TELEGRAM UPDATE ERROR', error);
      return { chatId: message.chatId, text: botText(locale).failed };
    }
  }

  return { handleTelegramUpdate };
}

// ---------------------------------------------------------------------------
// Production dependencies (Prisma)
// ---------------------------------------------------------------------------

async function db() {
  return (await import('../prisma')).prisma;
}

const LINKED_USER_SELECT = {
  id: true,
  username: true,
  language: true,
  timeZone: true,
  favoriteExercises: true,
  dailyGoalPoints: true,
} as const;

/** Rolls the link transaction back when the chat's owner changed after the question. */
class LinkRaceError extends Error {}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const prismaBotDeps: TelegramBotDeps = {
  hitRateLimit: async (key, limit, windowSeconds) => (await import('../rate-limit')).hitRateLimit(key, limit, windowSeconds),
  findUserByChat: async (chatId) => {
    const prisma = await db();
    return prisma.user.findFirst({ where: { telegramChatId: chatId, deletedAt: null }, select: LINKED_USER_SELECT });
  },
  findLinkCode: async (code, now) => {
    const prisma = await db();
    const row = await prisma.telegramLinkCode.findUnique({
      where: { code },
      select: { userId: true, expiresAt: true, user: { select: { username: true, deletedAt: true } } },
    });
    if (!row || row.expiresAt <= now || row.user.deletedAt) return null;
    return { userId: row.userId, username: row.user.username };
  },
  linkChat: async ({ code, userId, chatId, expectedOwnerId, now }) => {
    const prisma = await db();
    try {
      return await prisma.$transaction(async (tx) => {
        // The code works once: whoever deletes it first links the chat.
        const claimed = await tx.telegramLinkCode.deleteMany({ where: { code, userId, expiresAt: { gt: now } } });
        if (claimed.count !== 1) throw new LinkRaceError();
        const owner = await tx.user.findFirst({ where: { telegramChatId: chatId, deletedAt: null }, select: { id: true } });
        if (owner && owner.id !== userId && owner.id !== expectedOwnerId) throw new LinkRaceError();
        await tx.telegramLinkCode.deleteMany({ where: { userId } });
        const before = await tx.user.findUnique({ where: { id: userId }, select: { telegramChatId: true } });
        // One chat — one account (deleted accounts holding the chat let it go too).
        await tx.user.updateMany({
          where: { telegramChatId: chatId, NOT: { id: userId } },
          data: { telegramChatId: null, telegramLinkedAt: null },
        });
        await tx.user.update({ where: { id: userId }, data: { telegramChatId: chatId, telegramLinkedAt: now } });
        return { previousChatId: before?.telegramChatId ?? null };
      });
    } catch (error) {
      if (error instanceof LinkRaceError) return null;
      throw error;
    }
  },
  unlinkChat: async (userId) => {
    const prisma = await db();
    await prisma.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkedAt: null } });
  },
  loadTodayWorkouts: async (userId, day) => {
    const prisma = await db();
    return prisma.workout.findMany({
      where: { userId, date: dayKeyToDbDate(day) },
      orderBy: { time: 'asc' },
      select: { exerciseType: true, reps: true, loadKg: true, durationSeconds: true },
    });
  },
  createWorkout: async (user, parsed, clientRequestId, now) => {
    const { createWorkoutForUser } = await import('../workout-create');
    const result = await createWorkoutForUser(
      { id: user.id, username: user.username, timeZone: user.timeZone },
      {
        exerciseType: parsed.exerciseType,
        reps: parsed.value,
        loadKg: parsed.loadKg,
        durationSeconds: parsed.durationSeconds,
        clientRequestId,
      },
      { source: 'telegram', now },
    );
    return result.workout;
  },
  notifyChatTakenOver: async (userId) => {
    const prisma = await db();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { language: true, deletedAt: true } });
    if (!user || user.deletedAt) return;
    // Straight into the notification centre: it is not one of the configurable events.
    await prisma.notification.create({ data: telegramUnlinkedNotification(userId, toNotifyLocale(user.language)) });
  },
  logError: (label, error) => {
    console.error(`${label}:`, errorText(error));
  },
  appUrl: () => process.env.APP_URL || '',
};

/** Handles one update with the real database; see `createTelegramBot`. */
export const handleTelegramUpdate = createTelegramBot(prismaBotDeps).handleTelegramUpdate;
