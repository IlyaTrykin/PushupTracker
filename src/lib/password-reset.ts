import crypto from 'node:crypto';
import { prisma } from '@/lib/prisma';

const RESET_TTL_MINUTES = 30;

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function getAppBaseUrl(request?: Request): string {
  const explicit = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/$/, '');

  if (request) {
    try {
      const url = new URL(request.url);
      return `${url.protocol}//${url.host}`;
    } catch {
      // ignore
    }
  }

  return 'http://localhost:3000';
}

export function buildPasswordResetUrl(token: string, request?: Request): string {
  const base = getAppBaseUrl(request);
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

export async function createPasswordResetToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000);

  await prisma.passwordResetToken.create({
    data: {
      userId,
      tokenHash,
      expiresAt,
    },
  });

  // Keep table compact.
  await prisma.passwordResetToken
    .deleteMany({
      where: {
        OR: [{ usedAt: { not: null } }, { expiresAt: { lt: new Date() } }],
      },
    })
    .catch(() => {});

  return { token, expiresAt };
}

export async function consumePasswordResetToken(token: string): Promise<{ userId: string } | null> {
  const tokenHash = sha256(token);
  const now = new Date();

  const row = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true, expiresAt: true, usedAt: true },
  });

  if (!row) return null;
  if (row.usedAt) return null;
  if (row.expiresAt.getTime() < now.getTime()) return null;

  await prisma.passwordResetToken.update({
    where: { id: row.id },
    data: { usedAt: now },
  });

  return { userId: row.userId };
}

export async function sendPasswordResetEmail(params: {
  to: string;
  username: string;
  resetUrl: string;
  expiresAt: Date;
}): Promise<{ sent: boolean }> {
  const { to, username, resetUrl, expiresAt } = params;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPortRaw = process.env.SMTP_PORT;
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const mailFrom = process.env.MAIL_FROM || process.env.SMTP_FROM || 'noreply@localhost';

  if (!smtpHost || !smtpPortRaw || !smtpUser || !smtpPass) {
    console.info('[password-reset] SMTP is not configured. Reset link:', { to, resetUrl, expiresAt: expiresAt.toISOString() });
    return { sent: false };
  }

  const smtpPort = Number(smtpPortRaw);
  const secure = process.env.SMTP_SECURE === 'true' || smtpPort === 465;

  const nodemailer = await import('nodemailer');
  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const expiresText = expiresAt.toLocaleString('ru-RU');

  await transporter.sendMail({
    from: mailFrom,
    to,
    subject: 'Сброс пароля',
    text: `Здравствуйте, ${username}.\n\nПерейдите по ссылке, чтобы сменить пароль:\n${resetUrl}\n\nСсылка действует до ${expiresText}.\n\nЕсли это были не вы, просто проигнорируйте письмо.`,
    html: `<p>Здравствуйте, <b>${escapeHtml(username)}</b>.</p><p>Перейдите по ссылке, чтобы сменить пароль:</p><p><a href="${escapeHtml(resetUrl)}">Сменить пароль</a></p><p>Ссылка действует до ${escapeHtml(expiresText)}.</p><p>Если это были не вы, просто проигнорируйте письмо.</p>`,
  });

  return { sent: true };
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
