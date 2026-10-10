/**
 * Points the Telegram bot at this app: setWebhook to `APP_URL/api/telegram/webhook`
 * with `TELEGRAM_WEBHOOK_SECRET` as `secret_token`, plus the bot's command menu.
 *
 *   npx tsx --env-file=.env scripts/telegram-set-webhook.ts            # set
 *   npx tsx --env-file=.env scripts/telegram-set-webhook.ts --info     # show current webhook
 *   npx tsx --env-file=.env scripts/telegram-set-webhook.ts --delete   # remove it
 *
 * Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL and TELEGRAM_API_BASE from env.
 * The token and the secret are never printed.
 */
import { callTelegramApi } from '../src/lib/telegram/api';
import { readTelegramConfig } from '../src/lib/telegram/config';

const SECRET_RE = /^[A-Za-z0-9_-]{16,256}$/;

const COMMANDS = {
  ru: [
    { command: 'today', description: 'Итог дня' },
    { command: 'help', description: 'Как записывать тренировки' },
    { command: 'stop', description: 'Отключить бота' },
  ],
  en: [
    { command: 'today', description: 'Today’s summary' },
    { command: 'help', description: 'How to log workouts' },
    { command: 'stop', description: 'Disconnect the bot' },
  ],
};

type WebhookInfo = { url?: string; pending_update_count?: number; last_error_message?: string; last_error_date?: number };

async function main() {
  const config = readTelegramConfig();
  const args = new Set(process.argv.slice(2));
  if (!config.token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const opts = { config, timeoutMs: 15000 };

  if (args.has('--info')) {
    const info = await callTelegramApi<WebhookInfo>('getWebhookInfo', {}, opts);
    console.log(`Webhook: ${info.url || '(none)'}; pending updates: ${info.pending_update_count ?? 0}`);
    if (info.last_error_message) console.log(`Last error: ${info.last_error_message}`);
    return;
  }

  if (args.has('--delete')) {
    await callTelegramApi('deleteWebhook', { drop_pending_updates: false }, opts);
    console.log('Webhook deleted');
    return;
  }

  if (!SECRET_RE.test(config.webhookSecret)) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET must be 16–256 characters of A–Z, a–z, 0–9, _ or -');
  }
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  if (!/^https:\/\//.test(appUrl)) throw new Error('APP_URL must be an https:// address (Telegram requires HTTPS)');
  const url = `${appUrl}/api/telegram/webhook`;

  await callTelegramApi('setWebhook', {
    url,
    secret_token: config.webhookSecret,
    allowed_updates: ['message'],
    max_connections: 10,
  }, opts);
  await callTelegramApi('setMyCommands', { commands: COMMANDS.ru }, opts);
  await callTelegramApi('setMyCommands', { commands: COMMANDS.en, language_code: 'en' }, opts);
  console.log(`Webhook set: ${url} (API ${config.apiBase})`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Failed');
  process.exitCode = 1;
});
