import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin as requireAdminUser, AuthError } from '@/lib/auth';
import bcrypt from 'bcryptjs';
import { buildPasswordResetUrl, createPasswordResetToken, sendPasswordResetEmail } from '@/lib/password-reset';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function usernameFromEmail(email: string) {
  const base = email.split('@')[0] || 'user';
  return base.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 32) || 'user';
}


export async function GET(request: Request) {
  let adminId: string;
  try { adminId = (await requireAdminUser(request)).id; } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true, username: true, avatarPath: true, isAdmin: true, createdAt: true, deletedAt: true },
    orderBy: { email: 'asc' },
  });

  return NextResponse.json({ users });
}

// body: { email, password, isAdmin?, username? }
export async function POST(request: Request) {
  let adminId: string;
  try { adminId = (await requireAdminUser(request)).id; } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const isAdmin = Boolean(body.isAdmin);
  const username = String(body.username || '').trim() || usernameFromEmail(email);

  if (!email) return jsonError('email обязателен');
  if (!password || password.length < 6) return jsonError('password минимум 6 символов');
  if (!username) return jsonError('username обязателен');

  const existsEmail = await prisma.user.findUnique({ where: { email } });
  if (existsEmail) return jsonError('Пользователь с таким email уже существует', 409);

  const existsUsername = await prisma.user.findUnique({ where: { username } }).catch(() => null);
  if (existsUsername) return jsonError('Пользователь с таким username уже существует', 409);

  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: { email, username, passwordHash, isAdmin },
    select: { id: true, email: true, username: true, isAdmin: true },
  });

  return NextResponse.json({ user });
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

    const { token, expiresAt } = await createPasswordResetToken(target.id);
    const resetUrl = buildPasswordResetUrl(token, request);
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

  const data: any = {};
  if (body.email !== undefined) data.email = String(body.email || '').trim().toLowerCase();
  if (body.username !== undefined) data.username = String(body.username || '').trim();
  if (body.isAdmin !== undefined) data.isAdmin = Boolean(body.isAdmin);

  if (body.password !== undefined) {
    const pw = String(body.password || '');
    if (pw.length < 6) return jsonError('password минимум 6 символов');
    data.passwordHash = await bcrypt.hash(pw, 10);
  }

  if (id === adminId && data.isAdmin === false) {
    return jsonError('Нельзя снять права администратора с текущей сессии', 400);
  }

  const user = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, email: true, username: true, avatarPath: true, isAdmin: true, createdAt: true, deletedAt: true },
  });

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
