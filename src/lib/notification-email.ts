import { getAppBaseUrl } from '@/lib/password-reset';

function esc(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function sendMail(params: { to: string; subject: string; text: string; html: string }) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPortRaw = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const mailFrom = process.env.MAIL_FROM || process.env.SMTP_FROM || 'noreply@localhost';

  if (!smtpHost || !smtpPortRaw || !smtpUser || !smtpPass) {
    console.info('[notify-email] SMTP is not configured', { to: params.to, subject: params.subject });
    return { sent: false };
  }

  const smtpPort = Number(smtpPortRaw);
  const secure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: mailFrom,
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
  });

  return { sent: true };
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

export async function sendChallengeInviteEmail(args: {
  to: string;
  invitedUsername: string;
  creatorUsername: string;
  challengeId: string;
  challengeName: string;
  request?: Request;
}) {
  const app = getAppBaseUrl(args.request);
  const link = `${app}/challenges?invite=${encodeURIComponent(args.challengeId)}`;

  const subject = 'Приглашение в соревнование';
  const text = `Здравствуйте, ${args.invitedUsername}.\n\n${args.creatorUsername} пригласил вас в соревнование "${args.challengeName}".\nПринять или отклонить приглашение: ${link}\n`;
  const html = `<p>Здравствуйте, <b>${esc(args.invitedUsername)}</b>.</p><p><b>${esc(args.creatorUsername)}</b> пригласил вас в соревнование: <b>${esc(args.challengeName)}</b>.</p><p><a href="${esc(link)}">Открыть приглашение и принять/отклонить</a></p>`;

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
