import { sendMail, type SendMailInput, type SendMailResult } from '@/lib/mail';
import { getPasswordResetBaseUrl, PasswordResetConfigError } from '@/lib/password-reset';

type SendFn = (input: SendMailInput) => Promise<SendMailResult>;

/**
 * Base for links in letters: `APP_URL`; outside production also the request host or
 * localhost. In production without `APP_URL` there is no trusted address — the letter
 * goes out without a link rather than with one to localhost or an attacker's Host.
 */
function letterLinkBase(request?: Request): string | null {
  try {
    return getPasswordResetBaseUrl(request);
  } catch (error) {
    if (error instanceof PasswordResetConfigError) return null;
    throw error;
  }
}

export function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type NotificationEmailMessage = { title: string; body?: string; link?: string };

function absoluteLink(link: string | undefined, appUrl: string | null): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  if (!appUrl) return null;
  return `${appUrl.replace(/\/+$/, '')}${link.startsWith('/') ? '' : '/'}${link}`;
}

/** Subject/text/html of a generic notification letter (used by `notifyUsers`). */
export function buildNotificationEmail(
  message: NotificationEmailMessage,
  locale: 'ru' | 'en',
  appUrl: string | null,
): { subject: string; text: string; html: string } {
  const url = absoluteLink(message.link, appUrl);
  const openLabel = locale === 'en' ? 'Open in PushUp' : 'Открыть в приложении';
  const textParts = [message.title, message.body, url ? `${openLabel}: ${url}` : null].filter(Boolean);
  const htmlParts = [
    `<p><b>${esc(message.title)}</b></p>`,
    message.body ? `<p>${esc(message.body)}</p>` : '',
    url ? `<p><a href="${esc(url)}">${esc(openLabel)}</a></p>` : '',
  ];
  return { subject: message.title, text: `${textParts.join('\n\n')}\n`, html: htmlParts.join('') };
}

export async function sendNotificationEmail(
  to: string,
  message: NotificationEmailMessage,
  locale: 'ru' | 'en',
  send: SendFn = sendMail,
) {
  const letter = buildNotificationEmail(message, locale, letterLinkBase());
  return send({ to, ...letter });
}

/** Plain-text line and HTML paragraph for a link, or nothing when there is no base URL. */
function linkParts(base: string | null, path: string, label: string): { text: string; html: string } {
  if (!base) return { text: '', html: '' };
  const url = `${base}${path}`;
  return { text: `${label}: ${url}\n`, html: `<p><a href="${esc(url)}">${esc(label)}</a></p>` };
}

export async function sendFriendRequestEmail(
  args: {
    to: string;
    inviterUsername: string;
    invitedUsername: string;
    requestId: string;
    request?: Request;
  },
  send: SendFn = sendMail,
) {
  const link = linkParts(
    letterLinkBase(args.request),
    `/friends?incomingRequest=${encodeURIComponent(args.requestId)}`,
    'Открыть запрос и принять/отклонить',
  );

  const subject = 'Новый запрос в друзья';
  const text = `Здравствуйте, ${args.invitedUsername}.\n\n${args.inviterUsername} отправил вам запрос в друзья.\n${link.text}`;
  const html = `<p>Здравствуйте, <b>${esc(args.invitedUsername)}</b>.</p><p><b>${esc(args.inviterUsername)}</b> отправил вам запрос в друзья.</p>${link.html}`;

  return send({ to: args.to, subject, text, html });
}

export async function sendAdminNewUserRegisteredEmail(
  args: {
    to: string;
    adminUsername: string;
    newUsername: string;
    newEmail: string;
    request?: Request;
  },
  send: SendFn = sendMail,
) {
  const link = linkParts(letterLinkBase(args.request), '/admin/users', 'Открыть админку');

  const subject = 'Новая регистрация пользователя';
  const text = `Здравствуйте, ${args.adminUsername}.\n\nЗарегистрирован новый пользователь:\nИмя: ${args.newUsername}\nEmail: ${args.newEmail}\n\n${link.text}`;
  const html = `<p>Здравствуйте, <b>${esc(args.adminUsername)}</b>.</p><p>Зарегистрирован новый пользователь:</p><ul><li>Имя: <b>${esc(args.newUsername)}</b></li><li>Email: <b>${esc(args.newEmail)}</b></li></ul>${link.html}`;

  return send({ to: args.to, subject, text, html });
}

export async function sendGroupJoinRequestEmail(
  args: {
    to: string;
    ownerUsername: string;
    requesterUsername: string;
    groupId: string;
    groupName: string;
    request?: Request;
  },
  send: SendFn = sendMail,
) {
  const link = linkParts(
    letterLinkBase(args.request),
    `/groups/${encodeURIComponent(args.groupId)}`,
    'Открыть группу и обработать заявку',
  );

  const subject = 'Новая заявка в группу';
  const text = `Здравствуйте, ${args.ownerUsername}.\n\n${args.requesterUsername} хочет вступить в группу "${args.groupName}".\n${link.text}`;
  const html = `<p>Здравствуйте, <b>${esc(args.ownerUsername)}</b>.</p><p><b>${esc(args.requesterUsername)}</b> хочет вступить в группу <b>${esc(args.groupName)}</b>.</p>${link.html}`;

  return send({ to: args.to, subject, text, html });
}

export async function sendGroupJoinResolvedEmail(
  args: {
    to: string;
    targetUsername: string;
    ownerUsername: string;
    groupId: string;
    groupName: string;
    approved: boolean;
    request?: Request;
  },
  send: SendFn = sendMail,
) {
  const link = linkParts(
    letterLinkBase(args.request),
    `/groups/${encodeURIComponent(args.groupId)}`,
    args.approved ? 'Открыть группу' : 'Открыть раздел групп',
  );

  const subject = args.approved ? 'Заявка в группу одобрена' : 'Заявка в группу отклонена';
  const text = args.approved
    ? `Здравствуйте, ${args.targetUsername}.\n\n${args.ownerUsername} одобрил вашу заявку в группу "${args.groupName}".\n${link.text}`
    : `Здравствуйте, ${args.targetUsername}.\n\n${args.ownerUsername} отклонил вашу заявку в группу "${args.groupName}".\n${link.text}`;
  const html = args.approved
    ? `<p>Здравствуйте, <b>${esc(args.targetUsername)}</b>.</p><p><b>${esc(args.ownerUsername)}</b> одобрил вашу заявку в группу <b>${esc(args.groupName)}</b>.</p>${link.html}`
    : `<p>Здравствуйте, <b>${esc(args.targetUsername)}</b>.</p><p><b>${esc(args.ownerUsername)}</b> отклонил вашу заявку в группу <b>${esc(args.groupName)}</b>.</p>${link.html}`;

  return send({ to: args.to, subject, text, html });
}
