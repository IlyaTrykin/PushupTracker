import crypto from 'node:crypto';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const RESET_TTL_MINUTES = 30;

function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/** Thrown when a reset link cannot be built safely (production without `APP_URL`). */
export class PasswordResetConfigError extends Error {
  constructor(message = 'APP_URL is required in production to build password reset links') {
    super(message);
    this.name = 'PasswordResetConfigError';
  }
}

function explicitAppUrl(): string | null {
  const explicit = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').trim();
  return explicit ? explicit.replace(/\/+$/, '') : null;
}

export function getAppBaseUrl(request?: Request): string {
  const explicit = explicitAppUrl();
  if (explicit) return explicit;

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

/**
 * Base URL for reset links. In production only `APP_URL` is trusted — never the
 * request's Host, which an attacker controls.
 */
export function getPasswordResetBaseUrl(request?: Request): string {
  const explicit = explicitAppUrl();
  if (explicit) return explicit;
  if (process.env.NODE_ENV === 'production') throw new PasswordResetConfigError();
  return getAppBaseUrl(request);
}

export function buildPasswordResetUrl(token: string, request?: Request): string {
  const base = getPasswordResetBaseUrl(request);
  return `${base}/reset-password?token=${encodeURIComponent(token)}`;
}

type ResetTokenWhere = {
  id?: string;
  userId?: string;
  usedAt?: null | { not: null };
  expiresAt?: { gt?: Date; lt?: Date };
  OR?: ResetTokenWhere[];
};

type PasswordResetTokenTable = {
  create(args: { data: { userId: string; tokenHash: string; expiresAt: Date } }): Promise<unknown>;
  findUnique(args: {
    where: { tokenHash: string };
    select: { id: true; userId: true };
  }): Promise<{ id: string; userId: string } | null>;
  updateMany(args: { where: ResetTokenWhere; data: { usedAt: Date } }): Promise<{ count: number }>;
  deleteMany(args: { where: ResetTokenWhere }): Promise<unknown>;
};

/** What runs inside one DB transaction of the reset flow. */
export type PasswordResetTx = {
  passwordResetToken: PasswordResetTokenTable;
  /** Locks the user row until the transaction ends: link issuing for one account is serialised. */
  lockUser(userId: string): Promise<void>;
  user: { update(args: { where: { id: string }; data: { passwordHash: string } }): Promise<unknown> };
  userProfileHistory: {
    create(args: {
      data: { userId: string; changedById: string; changes: { passwordReset: { at: string } } };
    }): Promise<unknown>;
  };
  session: { deleteMany(args: { where: { userId: string } }): Promise<unknown> };
};

/** The part of the Prisma client the reset functions use (a fake in tests). */
export type PasswordResetStore = {
  passwordResetToken: PasswordResetTokenTable;
  transaction<T>(fn: (tx: PasswordResetTx) => Promise<T>): Promise<T>;
};

function prismaTx(tx: Prisma.TransactionClient): PasswordResetTx {
  return {
    passwordResetToken: tx.passwordResetToken,
    user: tx.user,
    userProfileHistory: tx.userProfileHistory,
    session: tx.session,
    async lockUser(userId) {
      await tx.$executeRaw`SELECT 1 FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    },
  };
}

const prismaStore: PasswordResetStore = {
  get passwordResetToken() {
    return prisma.passwordResetToken;
  },
  transaction: (fn) => prisma.$transaction((tx) => fn(prismaTx(tx))),
};

/**
 * Issues a new link token; any earlier unused tokens of the user stop working. Cancelling
 * the old tokens and inserting the new one happen in one transaction under a lock on the
 * user, so simultaneous requests still leave exactly one live link.
 */
export async function createPasswordResetToken(
  userId: string,
  db: PasswordResetStore = prismaStore,
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + RESET_TTL_MINUTES * 60 * 1000);

  await db.transaction(async (tx) => {
    await tx.lockUser(userId);
    await tx.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    });
    await tx.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
  });

  // Keep table compact: drop used and expired tokens (the new one is neither).
  await db.passwordResetToken
    .deleteMany({
      where: {
        OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }],
      },
    })
    .catch(() => {});

  return { token, expiresAt };
}

/** Marks the token used and returns its owner — exactly once, even under concurrent requests. */
export async function consumePasswordResetToken(
  token: string,
  db: Pick<PasswordResetStore, 'passwordResetToken'> = prismaStore,
): Promise<{ userId: string } | null> {
  const tokenHash = sha256(token);
  const now = new Date();

  const row = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { id: true, userId: true },
  });
  if (!row) return null;

  const { count } = await db.passwordResetToken.updateMany({
    where: { id: row.id, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });

  return count === 1 ? { userId: row.userId } : null;
}

/**
 * Sets the new password by a reset link: returns the owner, or null for a dead link.
 * Burning the link, the new hash, the history row and dropping every session are one
 * transaction — if any step fails nothing changes, the link stays usable and the caller
 * answers 500 rather than «ok».
 */
export async function completePasswordReset(
  token: string,
  passwordHash: string,
  db: PasswordResetStore = prismaStore,
): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    // Lock order as in createPasswordResetToken — user first, then tokens — so a parallel
    // «send me a link» and this reset never deadlock on each other.
    const owner = await tx.passwordResetToken.findUnique({
      where: { tokenHash: sha256(token) },
      select: { id: true, userId: true },
    });
    if (!owner) return null;
    await tx.lockUser(owner.userId);
    // Atomic: of two requests with the same token only one gets through.
    const consumed = await consumePasswordResetToken(token, tx);
    if (!consumed) return null;
    const { userId } = consumed;
    const now = new Date();
    await tx.user.update({ where: { id: userId }, data: { passwordHash } });
    await tx.userProfileHistory.create({
      data: { userId, changedById: userId, changes: { passwordReset: { at: now.toISOString() } } },
    });
    await tx.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
    await tx.session.deleteMany({ where: { userId } });
    return consumed;
  });
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
    if (process.env.NODE_ENV === 'production') {
      // The link is a credential: it never goes to production logs.
      console.info('[password-reset] SMTP is not configured; reset email not sent.');
    } else {
      console.info('[password-reset] SMTP is not configured. Reset link:', { to, resetUrl, expiresAt: expiresAt.toISOString() });
    }
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
