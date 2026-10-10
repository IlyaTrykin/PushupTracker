import { sendMail } from '@/lib/mail';
import { getAppBaseUrl } from '@/lib/password-reset';

export function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export type NotificationEmailMessage = { title: string; body?: string; link?: string };

function absoluteLink(link: string | undefined, appUrl: string): string | null {
  if (!link) return null;
  if (/^https?:\/\//i.test(link)) return link;
  return `${appUrl.replace(/\/+$/, '')}${link.startsWith('/') ? '' : '/'}${link}`;
}

/** Subject/text/html of a generic notification letter (used by `notifyUsers`). */
export function buildNotificationEmail(
  message: NotificationEmailMessage,
  locale: 'ru' | 'en',
  appUrl: string,
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

export async function sendNotificationEmail(to: string, message: NotificationEmailMessage, locale: 'ru' | 'en') {
  const letter = buildNotificationEmail(message, locale, getAppBaseUrl());
  return sendMail({ to, ...letter });
}

export async function sendFriendRequestEmail(args: {
  to: string;
  inviterUsername: string;
  invitedUsername: string;
  requestId: string;
  request?: Request;
}) {
  const app = getAppBaseUrl(args.request);
  const link = `${app}/friends?incomingRequest=${encodeURIComponent(args.requestId)}`;

  const subject = 'Новый запрос в друзья';
  const text = `Здравствуйте, ${args.invitedUsername}.\n\n${args.inviterUsername} отправил вам запрос в друзья.\nПринять или отклонить запрос: ${link}\n`;
  const html = `<p>Здравствуйте, <b>${esc(args.invitedUsername)}</b>.</p><p><b>${esc(args.inviterUsername)}</b> отправил вам запрос в друзья.</p><p><a href="${esc(link)}">Открыть запрос и принять/отклонить</a></p>`;

  return sendMail({ to: args.to, subject, text, html });
}

export async function sendAdminNewUserRegisteredEmail(args: {
  to: string;
  adminUsername: string;
  newUsername: string;
  newEmail: string;
  request?: Request;
}) {
  const app = getAppBaseUrl(args.request);
  const link = `${app}/admin/users`;

  const subject = 'Новая регистрация пользователя';
  const text = `Здравствуйте, ${args.adminUsername}.\n\nЗарегистрирован новый пользователь:\nИмя: ${args.newUsername}\nEmail: ${args.newEmail}\n\nОткрыть админку: ${link}\n`;
  const html = `<p>Здравствуйте, <b>${esc(args.adminUsername)}</b>.</p><p>Зарегистрирован новый пользователь:</p><ul><li>Имя: <b>${esc(args.newUsername)}</b></li><li>Email: <b>${esc(args.newEmail)}</b></li></ul><p><a href="${esc(link)}">Открыть админку</a></p>`;

  return sendMail({ to: args.to, subject, text, html });
}

export async function sendGroupJoinRequestEmail(args: {
  to: string;
  ownerUsername: string;
  requesterUsername: string;
  groupId: string;
  groupName: string;
  request?: Request;
}) {
  const app = getAppBaseUrl(args.request);
  const link = `${app}/groups/${encodeURIComponent(args.groupId)}`;

  const subject = 'Новая заявка в группу';
  const text = `Здравствуйте, ${args.ownerUsername}.\n\n${args.requesterUsername} хочет вступить в группу "${args.groupName}".\nОткрыть группу и обработать заявку: ${link}\n`;
  const html = `<p>Здравствуйте, <b>${esc(args.ownerUsername)}</b>.</p><p><b>${esc(args.requesterUsername)}</b> хочет вступить в группу <b>${esc(args.groupName)}</b>.</p><p><a href="${esc(link)}">Открыть группу и обработать заявку</a></p>`;

  return sendMail({ to: args.to, subject, text, html });
}

export async function sendGroupJoinResolvedEmail(args: {
  to: string;
  targetUsername: string;
  ownerUsername: string;
  groupId: string;
  groupName: string;
  approved: boolean;
  request?: Request;
}) {
  const app = getAppBaseUrl(args.request);
  const link = `${app}/groups/${encodeURIComponent(args.groupId)}`;

  const subject = args.approved ? 'Заявка в группу одобрена' : 'Заявка в группу отклонена';
  const text = args.approved
    ? `Здравствуйте, ${args.targetUsername}.\n\n${args.ownerUsername} одобрил вашу заявку в группу "${args.groupName}".\nОткрыть группу: ${link}\n`
    : `Здравствуйте, ${args.targetUsername}.\n\n${args.ownerUsername} отклонил вашу заявку в группу "${args.groupName}".\nОткрыть раздел групп: ${link}\n`;
  const html = args.approved
    ? `<p>Здравствуйте, <b>${esc(args.targetUsername)}</b>.</p><p><b>${esc(args.ownerUsername)}</b> одобрил вашу заявку в группу <b>${esc(args.groupName)}</b>.</p><p><a href="${esc(link)}">Открыть группу</a></p>`
    : `<p>Здравствуйте, <b>${esc(args.targetUsername)}</b>.</p><p><b>${esc(args.ownerUsername)}</b> отклонил вашу заявку в группу <b>${esc(args.groupName)}</b>.</p><p><a href="${esc(link)}">Открыть раздел групп</a></p>`;

  return sendMail({ to: args.to, subject, text, html });
}
