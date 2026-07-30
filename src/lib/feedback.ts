import { sendMail } from '@/lib/mail';
import { esc } from '@/lib/notification-email';
import { getAppBaseUrl } from '@/lib/password-reset';

export const FEEDBACK_MAX_LENGTH = 4000;

/** Метка проекта в теме письма: почтовый ящик общий на несколько проектов. */
export function getFeedbackProjectLabel(): string {
  return process.env.FEEDBACK_PROJECT_LABEL || 'PushUp Tracker';
}

function getFeedbackRecipient(): string {
  return process.env.FEEDBACK_TO || 'ilya.trykin@gmail.com';
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
  username: string;
  userEmail: string | null;
  userId: string;
  request?: Request;
}): Promise<{ sent: boolean }> {
  const label = getFeedbackProjectLabel();
  const site = getSite(args.request);
  const from = args.userEmail ? `${args.username} <${args.userEmail}>` : args.username;

  const text = [
    `Новое сообщение обратной связи · ${label} (${site}).`,
    '',
    `От: ${from}`,
    `ID пользователя: ${args.userId}`,
    '',
    'Сообщение:',
    args.message,
  ].join('\n');

  const html = [
    `<p>Новое сообщение обратной связи · <b>${esc(label)}</b> (${esc(site)}).</p>`,
    `<p>От: <b>${esc(from)}</b><br/>ID пользователя: ${esc(args.userId)}</p>`,
    `<p>Сообщение:</p>`,
    `<p style="white-space:pre-wrap">${esc(args.message)}</p>`,
  ].join('');

  return sendMail(
    {
      to: getFeedbackRecipient(),
      subject: `[${label}] Обратная связь · ${site}`,
      text,
      html,
      ...(args.userEmail ? { replyTo: args.userEmail } : {}),
    },
    { prefer: 'resend' },
  );
}
