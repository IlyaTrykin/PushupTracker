import { NextResponse, after } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram/api';
import { handleTelegramUpdate } from '@/lib/telegram/bot';
import { isTelegramEnabled, readTelegramConfig, verifyWebhookSecret } from '@/lib/telegram/config';

export const dynamic = 'force-dynamic';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Telegram webhook. Protected by `X-Telegram-Bot-Api-Secret-Token` (= `TELEGRAM_WEBHOOK_SECRET`);
 * unless the bot is on (`isTelegramEnabled`) the endpoint does not exist. Telegram always gets a
 * quick 200 (otherwise it re-delivers the update); the reply and the notices to other chats are
 * sent after the response. A failure inside the handler is answered by the bot itself
 * («Не получилось, попробуй ещё раз»).
 */
export async function POST(request: Request) {
  const config = readTelegramConfig();
  if (!isTelegramEnabled(config)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!verifyWebhookSecret(request.headers.get('x-telegram-bot-api-secret-token'), config.webhookSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const update = await request.json().catch(() => null);
  try {
    const reply = await handleTelegramUpdate(update);
    if (reply) {
      after(async () => {
        const send = async (chatId: string, text: string, opts: { buttons?: string[]; removeKeyboard?: boolean } = {}) => {
          try {
            await sendTelegramMessage(chatId, text, opts);
          } catch (error) {
            console.error('TELEGRAM REPLY ERROR:', errorText(error));
          }
        };
        await send(reply.chatId, reply.text, { buttons: reply.buttons, removeKeyboard: reply.removeKeyboard });
        for (const notice of reply.notices ?? []) await send(notice.chatId, notice.text);
      });
    }
  } catch (error) {
    console.error('TELEGRAM WEBHOOK ERROR:', errorText(error));
  }
  return NextResponse.json({ ok: true });
}
