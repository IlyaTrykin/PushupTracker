import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireAdmin as requireAdminUser, AuthError, deleteUserSessions, getSessionToken } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { normalizeEmail, PASSWORD_MIN_LENGTH, validateNewPassword } from '@/lib/account-validation';
import {
  buildPasswordResetUrl,
  createPasswordResetToken,
  PasswordResetConfigError,
  sendPasswordResetEmail,
} from '@/lib/password-reset';

const PASSWORD_RULE_TEXT = `password: от ${PASSWORD_MIN_LENGTH} до 128 символов`;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

const USERNAME_TAKEN = 'Пользователь с таким username уже существует';
const EMAIL_TAKEN = 'Пользователь с таким email уже существует';

/** Ник занят без учёта регистра (как индекс `User_username_lower_key`); `exceptId` — сам правимый. */
async function usernameTaken(username: string, exceptId?: string): Promise<boolean> {
  const hit = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return Boolean(hit);
}

/** P2002 (гонка мимо проверки) → 409 с текстом по полю; иначе null. */
function uniqueViolationResponse(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') return null;
  const target = JSON.stringify(error.meta?.target ?? '');
  return jsonError(target.includes('email') ? EMAIL_TAKEN : USERNAME_TAKEN, 409);
}

function usernameFromEmail(email: string) {
  const base = email.split('@')[0] || 'user';
  return base.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'user';
}


export async function GET(request: Request) {
  try { await requireAdminUser(request); } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, avatarPath: true, isAdmin: true, createdAt: true, deletedAt: true },
    orderBy: { email: 'asc' },
  });

  // Последняя активность: максимум из последнего входа и последней тренировки.
  // Сессии чистятся при выходе и по истечении срока, поэтому вход — лишь нижняя оценка.
  const [lastSessions, lastWorkouts] = await Promise.all([
    prisma.session.groupBy({ by: ['userId'], _max: { createdAt: true } }),
    prisma.workout.groupBy({ by: ['userId'], _max: { time: true } }),
  ]);

  const lastActive = new Map<string, Date>();
  const bump = (userId: string, at: Date | null) => {
    if (!at) return;
    const current = lastActive.get(userId);
    if (!current || at > current) lastActive.set(userId, at);
  };
  lastSessions.forEach((row) => bump(row.userId, row._max.createdAt));
  lastWorkouts.forEach((row) => bump(row.userId, row._max.time));

  return NextResponse.json({
    users: users.map((u) => ({ ...u, lastActiveAt: lastActive.get(u.id)?.toISOString() ?? null })),
  });
}

// body: { email, password, isAdmin?, username? }
export async function POST(request: Request) {
  try { await requireAdminUser(request); } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  if (!String(body.email || '').trim()) return jsonError('email обязателен');
  const email = normalizeEmail(body.email);
  if (!email) return jsonError('Некорректный email');
  const password = String(body.password || '');
  const isAdmin = Boolean(body.isAdmin);
  const username = String(body.username || '').trim() || usernameFromEmail(email);

  if (!validateNewPassword(password).ok) return jsonError(PASSWORD_RULE_TEXT);
  if (!username) return jsonError('username обязателен');

  const existsEmail = await prisma.user.findUnique({ where: { email } });
  if (existsEmail) return jsonError(EMAIL_TAKEN, 409);

  if (await usernameTaken(username)) return jsonError(USERNAME_TAKEN, 409);

  const passwordHash = await bcrypt.hash(password, 10);

  try {
    const user = await prisma.user.create({
      data: { email, username, passwordHash, isAdmin },
      select: { id: true, email: true, username: true, isAdmin: true },
    });
    return NextResponse.json({ user });
  } catch (e) {
    const taken = uniqueViolationResponse(e);
    if (taken) return taken;
    throw e;
  }
}

// body: { id, email?, username?, password?, isAdmin? }
export async function PATCH(request: Request) {
  let adminId: string;
  try { adminId = (await requireAdminUser(request)).id; } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  if (body.sendResetLink === true) {
    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, email: true, username: true, deletedAt: true },
    });

    if (!target || target.deletedAt) return jsonError('Пользователь не найден', 404);

    let resetUrl: string;
    let expiresAt: Date;
    try {
      const issued = await createPasswordResetToken(target.id);
      expiresAt = issued.expiresAt;
      resetUrl = buildPasswordResetUrl(issued.token, request);
    } catch (e) {
      if (e instanceof PasswordResetConfigError) {
        console.error('ADMIN RESET LINK CONFIG ERROR:', e.message);
        return jsonError('APP_URL не задан: ссылку на сброс нельзя построить', 500);
      }
      throw e;
    }
    await sendPasswordResetEmail({
      to: target.email,
      username: target.username,
      resetUrl,
      expiresAt,
    });

    return NextResponse.json({ ok: true });
  }

  // Restore soft-deleted profile (allowed within 1 year)
  if (body.restore === true) {
    const u = await prisma.user.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!u?.deletedAt) return jsonError('Профиль не удалён', 400);
    const ageMs = Date.now() - u.deletedAt.getTime();
    const oneYearMs = 1000 * 60 * 60 * 24 * 365;
    if (ageMs > oneYearMs) return jsonError('Срок восстановления истёк (1 год)', 400);

    const user = await prisma.user.update({
      where: { id },
      data: { deletedAt: null, deletedById: null },
      select: { id: true, email: true, username: true, avatarPath: true, isAdmin: true, createdAt: true, deletedAt: true },
    });
    await prisma.userProfileHistory.create({
      data: { userId: id, changedById: adminId, changes: { restored: { at: new Date().toISOString() } } },
    }).catch(() => {});

    return NextResponse.json({ user });
  }

  const data: Prisma.UserUpdateInput = {};
  if (body.email !== undefined) {
    const email = normalizeEmail(body.email);
    if (!email) return jsonError('Некорректный email');
    data.email = email;
  }
  if (body.username !== undefined) {
    const username = String(body.username || '').trim();
    if (!username) return jsonError('username обязателен');
    if (await usernameTaken(username, id)) return jsonError(USERNAME_TAKEN, 409);
    data.username = username;
  }
  if (body.isAdmin !== undefined) data.isAdmin = Boolean(body.isAdmin);

  const passwordChanged = body.password !== undefined;
  if (passwordChanged) {
    const pw = String(body.password || '');
    if (!validateNewPassword(pw).ok) return jsonError(PASSWORD_RULE_TEXT);
    data.passwordHash = await bcrypt.hash(pw, 10);
  }

  if (id === adminId && data.isAdmin === false) {
    return jsonError('Нельзя снять права администратора с текущей сессии', 400);
  }

  let user;
  try {
    user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, username: true, avatarPath: true, isAdmin: true, createdAt: true, deletedAt: true },
    });
  } catch (e) {
    const taken = uniqueViolationResponse(e);
    if (taken) return taken;
    throw e;
  }

  // A new password set by the admin logs the user out everywhere (as reset and change-password do).
  // The admin changing their own password keeps the current session.
  if (passwordChanged) {
    await deleteUserSessions(id, id === adminId ? getSessionToken(request) : null);
  }

  return NextResponse.json({ user });
}

// body: { id }
export async function DELETE(request: Request) {
  let adminId: string;
  try { adminId = (await requireAdminUser(request)).id; } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');
  if (id === adminId) return jsonError('Нельзя удалить самого себя', 400);

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id }, select: { deletedAt: true } });
    if (!u) return;
    if (u.deletedAt) return;
    await tx.user.update({ where: { id }, data: { deletedAt: now, deletedById: adminId } });
    await tx.userProfileHistory.create({
      data: { userId: id, changedById: adminId, changes: { deletedAt: { from: null, to: now.toISOString() } } },
    });
  });

  // invalidate sessions
  await prisma.session.deleteMany({ where: { userId: id } }).catch(() => {});

  return NextResponse.json({ ok: true, deletedAt: now.toISOString() });
}
