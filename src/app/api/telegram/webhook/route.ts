import { NextResponse, after } from 'next/server';
import { sendTelegramMessage } from '@/lib/telegram/api';
import { handleTelegramUpdate } from '@/lib/telegram/bot';
import { readTelegramConfig, verifyWebhookSecret } from '@/lib/telegram/config';

export const dynamic = 'force-dynamic';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Telegram webhook. Protected by `X-Telegram-Bot-Api-Secret-Token` (= `TELEGRAM_WEBHOOK_SECRET`);
 * without the bot token or the secret the endpoint does not exist. Telegram always gets a quick
 * 200 (otherwise it re-delivers the update); the reply is sent after the response.
 */
export async function POST(request: Request) {
  const config = readTelegramConfig();
  if (!config.token || !config.webhookSecret) {
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
        try {
          await sendTelegramMessage(reply.chatId, reply.text);
        } catch (error) {
          console.error('TELEGRAM REPLY ERROR:', errorText(error));
        }
      });
    }
  } catch (error) {
    console.error('TELEGRAM WEBHOOK ERROR:', errorText(error));
  }
  return NextResponse.json({ ok: true });
}
