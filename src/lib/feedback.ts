import { sendMail } from '@/lib/mail';
import { esc } from '@/lib/notification-email';
import { getAppBaseUrl } from '@/lib/password-reset';

export const FEEDBACK_MAX_LENGTH = 4000;

/** Тип обращения (G05): общая жалоба — тоже сюда; жалоба на человека — `reports.ts`. */
export const FEEDBACK_TYPES = ['bug', 'idea', 'complaint'] as const;
export type FeedbackType = (typeof FEEDBACK_TYPES)[number];
export const DEFAULT_FEEDBACK_TYPE: FeedbackType = 'bug';

/** Подпись типа в письме владельцу (ящик читается по-русски). */
const FEEDBACK_TYPE_LABELS: Record<FeedbackType, string> = {
  bug: 'Ошибка',
  idea: 'Идея',
  complaint: 'Жалоба',
};

export type FeedbackInput =
  | { ok: true; message: string; type: FeedbackType }
  | { ok: false; code: 'BAD_JSON' | 'EMPTY' | 'TOO_LONG' | 'BAD_TYPE'; error: string };

/**
 * Тело `POST /api/feedback { message, type? }`. Тип — по белому списку; без типа (старые
 * версии приложения) — `bug`, неизвестный — отказ.
 */
export function parseFeedbackInput(body: unknown): FeedbackInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, code: 'BAD_JSON', error: 'Некорректный JSON' };
  const raw = body as Record<string, unknown>;
  const message = String(raw.message ?? '').trim();
  if (!message) return { ok: false, code: 'EMPTY', error: 'Сообщение не может быть пустым' };
  if (message.length > FEEDBACK_MAX_LENGTH) return { ok: false, code: 'TOO_LONG', error: 'Сообщение слишком длинное' };
  const type = raw.type === undefined || raw.type === null ? DEFAULT_FEEDBACK_TYPE : raw.type;
  if (typeof type !== 'string' || !(FEEDBACK_TYPES as readonly string[]).includes(type)) {
    return { ok: false, code: 'BAD_TYPE', error: 'Неизвестный тип обращения' };
  }
  return { ok: true, message, type: type as FeedbackType };
}

/** Метка проекта в теме письма: почтовый ящик общий на несколько проектов. */
export function getFeedbackProjectLabel(): string {
  return process.env.FEEDBACK_PROJECT_LABEL || 'PushUp Tracker';
}

/** Адрес получателя — только из env (`FEEDBACK_TO`); без него письмо не отправляется. */
function getFeedbackRecipient(): string | null {
  const to = process.env.FEEDBACK_TO?.trim();
  return to || null;
}

/** Домен приложения без схемы — попадает в тему и тело письма. */
function getSite(request?: Request): string {
  return getAppBaseUrl(request).replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * Письмо обратной связи администратору. Reply-To — почта автора, чтобы отвечать
 * прямо из ящика. Адрес получателя живёт в env и в интерфейсе не показывается.
 */
export async function sendFeedbackEmail(args: {
  message: string;
  type: FeedbackType;
  username: string;
  userEmail: string | null;
  userId: string;
  request?: Request;
}): Promise<{ sent: boolean }> {
  const to = getFeedbackRecipient();
  if (!to) {
    console.warn('[feedback] FEEDBACK_TO is not set — feedback email skipped');
    return { sent: false };
  }

  const label = getFeedbackProjectLabel();
  const site = getSite(args.request);
  const from = args.userEmail ? `${args.username} <${args.userEmail}>` : args.username;
  const typeLabel = FEEDBACK_TYPE_LABELS[args.type];

  const text = [
    `Новое сообщение обратной связи · ${label} (${site}).`,
    '',
    `Тип: ${typeLabel}`,
    `От: ${from}`,
    `ID пользователя: ${args.userId}`,
    '',
    'Сообщение:',
    args.message,
  ].join('\n');

  const html = [
    `<p>Новое сообщение обратной связи · <b>${esc(label)}</b> (${esc(site)}).</p>`,
    `<p>Тип: <b>${esc(typeLabel)}</b><br/>От: <b>${esc(from)}</b><br/>ID пользователя: ${esc(args.userId)}</p>`,
    `<p>Сообщение:</p>`,
    `<p style="white-space:pre-wrap">${esc(args.message)}</p>`,
  ].join('');

  return sendMail(
    {
      to,
      subject: `[${label}] ${typeLabel} · Обратная связь · ${site}`,
      text,
      html,
      ...(args.userEmail ? { replyTo: args.userEmail } : {}),
    },
    { prefer: 'resend' },
  );
}
