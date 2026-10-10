import { NextResponse, after } from 'next/server';
import { AuthError, requestLocale, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { hitRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { sendTelegramMessage } from '@/lib/telegram/api';
import {
  TELEGRAM_LINK_CODE_TTL_MS,
  createLinkCode,
  isTelegramEnabled,
  readTelegramConfig,
  telegramStartLink,
} from '@/lib/telegram/config';
import { toNotifyLocale } from '@/lib/notify';
import { telegramMessages } from '@/i18n/messages/features/telegram';

export const dynamic = 'force-dynamic';

/** Link codes one user may create per hour. */
const LINK_CODE_LIMIT_PER_HOUR = 10;

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

function notConfigured() {
  return jsonError('Not found', 404, 'TELEGRAM_NOT_CONFIGURED');
}

function handleError(e: unknown, label: string) {
  if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
  console.error(`${label}:`, e instanceof Error ? e.message : e);
  return jsonError('Внутренняя ошибка сервера', 500);
}

/** `{ linked, linkedAt }` of the current user; 404 when the bot is not configured. */
export async function GET(request: Request) {
  if (!isTelegramEnabled()) return notConfigured();
  try {
    const user = await requireUser(request);
    const row = await prisma.user.findUnique({
      where: { id: user.id },
      select: { telegramChatId: true, telegramLinkedAt: true },
    });
    return NextResponse.json({
      linked: Boolean(row?.telegramChatId),
      linkedAt: row?.telegramChatId ? row.telegramLinkedAt?.toISOString() ?? null : null,
    });
  } catch (e) {
    return handleError(e, 'TELEGRAM LINK GET ERROR');
  }
}

/** A one-time link `https://t.me/<bot>?start=<code>` valid for 15 minutes; earlier codes stop working. */
export async function POST(request: Request) {
  if (!isTelegramEnabled()) return notConfigured();
  try {
    const user = await requireUser(request);
    const limit = await hitRateLimit(`telegram-link:${user.id}`, LINK_CODE_LIMIT_PER_HOUR, 60 * 60);
    if (!limit.ok) return tooManyRequests(limit.retryAfterSeconds, requestLocale(request));

    const now = new Date();
    const code = createLinkCode();
    const expiresAt = new Date(now.getTime() + TELEGRAM_LINK_CODE_TTL_MS);
    await prisma.$transaction([
      prisma.telegramLinkCode.deleteMany({ where: { OR: [{ userId: user.id }, { expiresAt: { lte: now } }] } }),
      prisma.telegramLinkCode.create({ data: { code, userId: user.id, expiresAt } }),
    ]);

    return NextResponse.json({ url: telegramStartLink(readTelegramConfig().botUsername, code), expiresAt: expiresAt.toISOString() });
  } catch (e) {
    return handleError(e, 'TELEGRAM LINK CREATE ERROR');
  }
}

/** Unlinks the chat (the bot tells the chat about it) and drops pending link codes. */
export async function DELETE(request: Request) {
  if (!isTelegramEnabled()) return notConfigured();
  try {
    const user = await requireUser(request);
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { telegramChatId: true, language: true } });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { telegramChatId: null, telegramLinkedAt: null } }),
      prisma.telegramLinkCode.deleteMany({ where: { userId: user.id } }),
    ]);

    const chatId = row?.telegramChatId;
    if (chatId) {
      const text = telegramMessages[toNotifyLocale(row.language)].bot.unlinkedFromApp;
      after(async () => {
        try {
          await sendTelegramMessage(chatId, text);
        } catch (error) {
          console.error('TELEGRAM UNLINK NOTICE ERROR:', error instanceof Error ? error.message : error);
        }
      });
    }
    return NextResponse.json({ linked: false, linkedAt: null });
  } catch (e) {
    return handleError(e, 'TELEGRAM UNLINK ERROR');
  }
}
