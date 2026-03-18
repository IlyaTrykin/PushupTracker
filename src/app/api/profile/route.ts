import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError, invalidateSession } from '@/lib/auth';
import { normalizeLocale } from '@/i18n/locale';
import { setPreferredLocaleCookie } from '@/i18n/server';

type ProfileHistoryChanges = Record<string, Prisma.InputJsonValue | null>;

function getErrorCode(error: unknown) {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code?: unknown }).code ?? '');
  }
  return '';
}

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function normalizeGender(v: unknown): string | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (['male', 'm', 'man', 'м', 'муж', 'мужской'].includes(s)) return 'male';
  if (['female', 'f', 'woman', 'ж', 'жен', 'женский'].includes(s)) return 'female';
  if (['other', 'другое'].includes(s)) return 'other';
  return null;
}

function parseBirthDate(v: unknown): Date | null {
  if (!v) return null;
  const s = String(v).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export async function GET(request: Request) {
  try {
    const me = await requireUser(request);

    const u = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        email: true,
        username: true,
        isAdmin: true,
        language: true,
        createdAt: true,
        updatedAt: true,
        gender: true,
        birthDate: true,
        weightKg: true,
        avatarPath: true,
        deletedAt: true,
      },
    });

    if (!u || u.deletedAt) return jsonError('UNAUTHORIZED', 401);
    return NextResponse.json(u);
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }
}

// Update profile fields: { username?, gender?, birthDate? }
export async function PATCH(request: Request) {
  try {
    const me = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body) return jsonError('Некорректный JSON');

    const nextUsername = body.username !== undefined ? String(body.username || '').trim() : undefined;
    const nextLanguage = body.language !== undefined ? normalizeLocale(body.language) : undefined;
    const nextGender = body.gender !== undefined ? normalizeGender(body.gender) : undefined;
    const nextBirthDate = body.birthDate !== undefined ? parseBirthDate(body.birthDate) : undefined;
    const nextWeightKg = body.weightKg !== undefined && body.weightKg !== null && String(body.weightKg).trim() !== ''
      ? Number(body.weightKg)
      : body.weightKg === null || body.weightKg === ''
        ? null
        : undefined;

    const current = await prisma.user.findUnique({
      where: { id: me.id },
      select: {
        id: true,
        username: true,
        language: true,
        gender: true,
        birthDate: true,
        weightKg: true,
        avatarPath: true,
        deletedAt: true,
      },
    });

    if (!current || current.deletedAt) return jsonError('UNAUTHORIZED', 401);

    const data: Prisma.UserUpdateInput = {};
    const changes: ProfileHistoryChanges = {};

    if (nextUsername !== undefined) {
      if (!nextUsername) return jsonError('Имя обязательно');
      if (nextUsername.length > 32) return jsonError('Имя слишком длинное (макс. 32)');
      if (!/^[a-zA-Z0-9._-]+$/.test(nextUsername)) return jsonError('Имя может содержать только латиницу, цифры и символы ._-');

      if (nextUsername !== current.username) {
        const exists = await prisma.user.findUnique({ where: { username: nextUsername } }).catch(() => null);
        if (exists) return jsonError('Имя уже занято', 409);
        data.username = nextUsername;
        changes.username = { from: current.username, to: nextUsername };
      }
    }

    if (nextLanguage !== undefined && nextLanguage !== current.language) {
      data.language = nextLanguage;
      changes.language = { from: current.language, to: nextLanguage };
    }

    if (nextGender !== undefined) {
      const cur = current.gender ?? null;
      if (nextGender !== cur) {
        data.gender = nextGender;
        changes.gender = { from: cur, to: nextGender };
      }
    }

    if (nextBirthDate !== undefined) {
      const cur = current.birthDate ? current.birthDate.toISOString().slice(0, 10) : null;
      const nxt = nextBirthDate ? nextBirthDate.toISOString().slice(0, 10) : null;
      if (cur !== nxt) {
        data.birthDate = nextBirthDate;
        changes.birthDate = { from: cur, to: nxt };
      }
    }

    if (nextWeightKg !== undefined) {
      const cur = current.weightKg ?? null;
      if (nextWeightKg !== null && (!Number.isFinite(nextWeightKg) || nextWeightKg < 30 || nextWeightKg > 250)) {
        return jsonError('Вес должен быть в диапазоне 30..250 кг');
      }
      if (nextWeightKg !== cur) {
        data.weightKg = nextWeightKg;
        changes.weightKg = { from: cur, to: nextWeightKg };
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ ok: true });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.user.update({
        where: { id: me.id },
        data,
        select: {
          id: true,
          email: true,
          username: true,
          isAdmin: true,
          language: true,
          createdAt: true,
          updatedAt: true,
          gender: true,
          birthDate: true,
          weightKg: true,
          avatarPath: true,
        },
      });
      await tx.userProfileHistory.create({
        data: {
          userId: me.id,
          changedById: me.id,
          changes,
        },
      });
      return u;
    });

    const res = NextResponse.json({ ok: true, user: updated });
    setPreferredLocaleCookie(res, normalizeLocale(updated.language), request);
    return res;
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    if (getErrorCode(e) === 'P2002') return jsonError('Имя уже занято', 409);
    return jsonError('INTERNAL_ERROR', 500);
  }
}

// Soft-delete own profile (can be restored by admin within 1 year)
export async function DELETE(request: Request) {
  try {
    const me = await requireUser(request);

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.findUnique({ where: { id: me.id }, select: { deletedAt: true } });
      if (!u || u.deletedAt) return;
      await tx.user.update({ where: { id: me.id }, data: { deletedAt: now, deletedById: me.id } });
      await tx.userProfileHistory.create({
        data: { userId: me.id, changedById: me.id, changes: { deletedAt: { from: null, to: now.toISOString() } } },
      });
    });

    // log out everywhere
    await prisma.session.deleteMany({ where: { userId: me.id } }).catch(() => {});
    await invalidateSession(request).catch(() => {});

    const res = NextResponse.json({ ok: true });
    res.cookies.set('session', '', { httpOnly: true, sameSite: 'lax', path: '/', maxAge: 0 });
    return res;
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }
}
