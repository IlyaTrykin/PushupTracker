/**
 * Outgoing Telegram Bot API calls. The base URL comes from `TELEGRAM_API_BASE`
 * (default https://api.telegram.org) so a proxy can be used where Telegram is blocked;
 * plain http only to localhost, otherwise nothing is sent (the URL carries the token).
 * Errors never include the request URL: it contains the bot token.
 */
import { isSafeTelegramApiBase, readTelegramConfig, type TelegramConfig } from './config';

export const TELEGRAM_SEND_TIMEOUT_MS = 5000;
/** Telegram rejects longer messages. */
export const TELEGRAM_MESSAGE_MAX_LENGTH = 4096;

export class TelegramApiError extends Error {
  constructor(message: string, public status: number | null, public errorCode: number | null = null) {
    super(message);
    this.name = 'TelegramApiError';
  }
}

type ApiResponse<T> = { ok: boolean; result?: T; description?: string; error_code?: number };

export async function callTelegramApi<T = unknown>(
  method: string,
  payload: Record<string, unknown>,
  opts: { config?: TelegramConfig; timeoutMs?: number } = {},
): Promise<T> {
  const config = opts.config ?? readTelegramConfig();
  if (!config.token) throw new TelegramApiError('Telegram bot token is not configured', null);
  if (!isSafeTelegramApiBase(config.apiBase)) {
    throw new TelegramApiError('TELEGRAM_API_BASE must be https:// (http:// only for localhost)', null);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TELEGRAM_SEND_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${config.apiBase}/bot${config.token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (error) {
    const reason = controller.signal.aborted ? 'timeout' : error instanceof Error ? error.name : 'network error';
    throw new TelegramApiError(`Telegram ${method} failed: ${reason}`, null);
  } finally {
    clearTimeout(timer);
  }

  const data = (await response.json().catch(() => null)) as ApiResponse<T> | null;
  if (!response.ok || !data?.ok) {
    const description = typeof data?.description === 'string' ? data.description.slice(0, 200) : `HTTP ${response.status}`;
    throw new TelegramApiError(`Telegram ${method} failed: ${description}`, response.status, data?.error_code ?? null);
  }
  return data.result as T;
}

export type TelegramSendOptions = {
  /** One-time reply keyboard: each entry is a button that sends its own text. */
  buttons?: string[];
  /** Hide the reply keyboard (ignored when `buttons` are given). */
  removeKeyboard?: boolean;
};

/** Plain-text message to a chat (no markup, link previews off), cut to Telegram's limit. */
export async function sendTelegramMessage(chatId: string, text: string, opts: TelegramSendOptions = {}): Promise<void> {
  const body = text.length > TELEGRAM_MESSAGE_MAX_LENGTH ? `${text.slice(0, TELEGRAM_MESSAGE_MAX_LENGTH - 1)}…` : text;
  const payload: Record<string, unknown> = {
    chat_id: chatId,
    text: body,
    link_preview_options: { is_disabled: true },
  };
  if (opts.buttons?.length) {
    payload.reply_markup = {
      keyboard: opts.buttons.map((button) => [{ text: button }]),
      one_time_keyboard: true,
      resize_keyboard: true,
    };
  } else if (opts.removeKeyboard) {
    payload.reply_markup = { remove_keyboard: true };
  }
  await callTelegramApi('sendMessage', payload);
}
