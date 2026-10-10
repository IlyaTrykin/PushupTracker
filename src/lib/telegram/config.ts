/**
 * Telegram bot settings from env. Values are secrets: never log or return them.
 * Unless `isTelegramEnabled` (token, bot username, webhook secret, https API base) the whole
 * feature is off: profile section hidden, routes 404, the notification channel silent.
 */
import crypto from 'crypto';

export const DEFAULT_TELEGRAM_API_BASE = 'https://api.telegram.org';
/** A link code lives 15 minutes and works once. */
export const TELEGRAM_LINK_CODE_TTL_MS = 15 * 60 * 1000;

export type TelegramConfig = {
  token: string;
  botUsername: string;
  webhookSecret: string;
  apiBase: string;
};

type Env = Record<string, string | undefined>;

export function readTelegramConfig(env: Env = process.env): TelegramConfig {
  return {
    token: (env.TELEGRAM_BOT_TOKEN || '').trim(),
    botUsername: (env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, ''),
    webhookSecret: (env.TELEGRAM_WEBHOOK_SECRET || '').trim(),
    apiBase: ((env.TELEGRAM_API_BASE || '').trim() || DEFAULT_TELEGRAM_API_BASE).replace(/\/+$/, ''),
  };
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The token is part of every API URL, so it may only travel over https; plain http is allowed
 * for a local stub or proxy on this machine (localhost / 127.0.0.1 / ::1).
 */
export function isSafeTelegramApiBase(apiBase: string): boolean {
  let url: URL;
  try {
    url = new URL(apiBase);
  } catch {
    return false;
  }
  if (url.protocol === 'https:') return true;
  return url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname);
}

/**
 * The one «bot is on» condition for the notification settings, linking, the webhook and the
 * Telegram channel: token + bot username + webhook secret + a safe API base.
 */
export function isTelegramEnabled(config: TelegramConfig = readTelegramConfig()): boolean {
  return Boolean(config.token && config.botUsername && config.webhookSecret && isSafeTelegramApiBase(config.apiBase));
}

/** Constant-time comparison of `X-Telegram-Bot-Api-Secret-Token`; an empty expected secret never matches. */
export function verifyWebhookSecret(received: string | null | undefined, expected: string): boolean {
  if (!expected || !received) return false;
  const a = crypto.createHash('sha256').update(received).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b) && received.length === expected.length;
}

export function telegramStartLink(botUsername: string, code: string): string {
  return `https://t.me/${encodeURIComponent(botUsername.replace(/^@/, ''))}?start=${encodeURIComponent(code)}`;
}

/** 32 url-safe characters from 24 random bytes (Telegram allows [A-Za-z0-9_-]{1,64} in `start`). */
export function createLinkCode(): string {
  return crypto.randomBytes(24).toString('base64url');
}
