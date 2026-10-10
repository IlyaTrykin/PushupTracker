/**
 * One incoming Telegram update → at most one reply. Linking by `/start <code>`,
 * `/stop`, `/help`, `/today` and workout messages (see `parse.ts`), written through
 * `createWorkoutForUser(…, { source: 'telegram' })`.
 *
 * Only private chats are served; other update kinds are ignored.
 */
import { dayKeyInZone, dayKeyToDbDate, normalizeTimeZone } from '../calendar-day';
import { getExercise } from '../exercises';
import { toNotifyLocale, type NotifyLocale } from '../notify';
import { hitRateLimit } from '../rate-limit';
import { WorkoutCreateError, createWorkoutForUser } from '../workout-create';
import { fillTelegramText, telegramMessages } from '../../i18n/messages/features/telegram';
import { isParsedCommand, parseWorkoutMessage, type ParsedWorkout } from './parse';
import { helpReply, needWeightReply, todayReply, workoutErrorReply, workoutRecordedReply, workoutsPoints, type ReplyGoal, type ReplyWorkout } from './replies';

/** Messages one chat may send per minute; the rest are dropped silently. */
export const TELEGRAM_CHAT_RATE_LIMIT = 20;
export const TELEGRAM_CHAT_RATE_WINDOW_SECONDS = 60;

export type BotReply = { chatId: string; text: string };

type IncomingMessage = {
  chatId: string;
  messageId: number | null;
  text: string;
  languageCode: string;
};

type LinkedUser = {
  id: string;
  username: string;
  language: string;
  timeZone: string;
  favoriteExercises: string[];
  dailyGoalPoints: number | null;
};

async function db() {
  return (await import('../prisma')).prisma;
}

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

function profileUrl(): string {
  return `${(process.env.APP_URL || '').replace(/\/+$/, '')}/profile`;
}

/** Language of a chat not linked to an account: from the Telegram client, Russian by default. */
function guestLocale(message: IncomingMessage): NotifyLocale {
  return message.languageCode.toLowerCase().startsWith('en') ? 'en' : 'ru';
}

function botText(locale: NotifyLocale) {
  return telegramMessages[locale].bot;
}

async function findLinkedUser(chatId: string): Promise<LinkedUser | null> {
  const prisma = await db();
  const user = await prisma.user.findUnique({
    where: { telegramChatId: chatId },
    select: {
      id: true,
      username: true,
      language: true,
      timeZone: true,
      favoriteExercises: true,
      dailyGoalPoints: true,
      deletedAt: true,
    },
  });
  if (!user || user.deletedAt) return null;
  return user;
}

async function linkChat(chatId: string, code: string, now: Date): Promise<LinkedUser | null> {
  const prisma = await db();
  const row = await prisma.telegramLinkCode.findUnique({
    where: { code },
    select: { userId: true, expiresAt: true, user: { select: { deletedAt: true } } },
  });
  if (!row || row.expiresAt <= now || row.user.deletedAt) return null;

  const linked = await prisma.$transaction(async (tx) => {
    // The code works once: whoever deletes it first links the chat.
    const claimed = await tx.telegramLinkCode.deleteMany({ where: { code, expiresAt: { gt: now } } });
    if (claimed.count !== 1) return false;
    await tx.telegramLinkCode.deleteMany({ where: { userId: row.userId } });
    // One chat — one account: a chat linked to someone else moves to this user.
    await tx.user.updateMany({
      where: { telegramChatId: chatId, NOT: { id: row.userId } },
      data: { telegramChatId: null, telegramLinkedAt: null },
    });
    await tx.user.update({ where: { id: row.userId }, data: { telegramChatId: chatId, telegramLinkedAt: now } });
    return true;
  });
  return linked ? findLinkedUser(chatId) : null;
}

async function unlinkChat(userId: string): Promise<void> {
  const prisma = await db();
  await prisma.user.update({ where: { id: userId }, data: { telegramChatId: null, telegramLinkedAt: null } });
}

async function loadTodayWorkouts(user: LinkedUser, now: Date): Promise<ReplyWorkout[]> {
  const prisma = await db();
  const day = dayKeyInZone(now, normalizeTimeZone(user.timeZone));
  return prisma.workout.findMany({
    where: { userId: user.id, date: dayKeyToDbDate(day) },
    orderBy: { time: 'asc' },
    select: { exerciseType: true, reps: true, loadKg: true, durationSeconds: true },
  });
}

function goalOf(user: LinkedUser, workouts: ReplyWorkout[]): ReplyGoal {
  return user.dailyGoalPoints ? { done: workoutsPoints(workouts), goal: user.dailyGoalPoints } : null;
}

async function recordWorkout(user: LinkedUser, parsed: ParsedWorkout, message: IncomingMessage, now: Date): Promise<string> {
  const locale = toNotifyLocale(user.language);
  if (getExercise(parsed.exerciseType).load && parsed.loadKg === undefined) {
    return needWeightReply(locale, parsed.exerciseType, parsed.value);
  }
  try {
    const result = await createWorkoutForUser(
      { id: user.id, username: user.username, timeZone: user.timeZone },
      {
        exerciseType: parsed.exerciseType,
        reps: parsed.value,
        loadKg: parsed.loadKg,
        durationSeconds: parsed.durationSeconds,
        // Telegram re-delivers an update when the webhook fails: the same message is recorded once.
        clientRequestId: message.messageId !== null ? `tg:${message.chatId}:${message.messageId}` : undefined,
      },
      { source: 'telegram', now },
    );
    const goal = user.dailyGoalPoints ? goalOf(user, await loadTodayWorkouts(user, now)) : null;
    return workoutRecordedReply(locale, result.workout, goal);
  } catch (error) {
    if (error instanceof WorkoutCreateError) return workoutErrorReply(locale, error.code);
    throw error;
  }
}

/** Handles one update; returns the reply to send, or null (ignored, rate-limited). */
export async function handleTelegramUpdate(update: unknown, now: Date = new Date()): Promise<BotReply | null> {
  const message = readIncomingMessage(update);
  if (!message) return null;
  const { chatId } = message;

  const limit = await hitRateLimit(`telegram-chat:${chatId}`, TELEGRAM_CHAT_RATE_LIMIT, TELEGRAM_CHAT_RATE_WINDOW_SECONDS);
  if (!limit.ok) return null;

  const reply = (text: string): BotReply => ({ chatId, text });
  const parsed = parseWorkoutMessage(message.text, []);

  if (parsed && isParsedCommand(parsed) && parsed.command === 'start' && parsed.arg) {
    const linked = await linkChat(chatId, parsed.arg, now);
    if (!linked) return reply(fillTelegramText(botText(guestLocale(message)).linkInvalid, { url: profileUrl() }));
    const locale = toNotifyLocale(linked.language);
    return reply(`${fillTelegramText(botText(locale).linked, { username: linked.username })}\n\n${helpReply(locale, linked.favoriteExercises)}`);
  }

  const user = await findLinkedUser(chatId);
  if (!user) return reply(fillTelegramText(botText(guestLocale(message)).notLinked, { url: profileUrl() }));
  const locale = toNotifyLocale(user.language);

  // Re-parse with the user's favourites: a bare number goes to their first favourite exercise.
  const own = parseWorkoutMessage(message.text, user.favoriteExercises);
  if (!own) return reply(botText(locale).unknown);

  if (isParsedCommand(own)) {
    switch (own.command) {
      case 'stop':
        await unlinkChat(user.id);
        return reply(botText(locale).unlinked);
      case 'today': {
        const workouts = await loadTodayWorkouts(user, now);
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
