import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';
import { prisma } from '@/lib/prisma';
import { requireAdmin as requireAdminUser, AuthError } from '@/lib/auth';

const MAX_FILE_BYTES = 300_000; // 300KB

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let adminId: string;
  try {
    adminId = (await requireAdminUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return jsonError('Некорректная форма');

  const id = String(form.get('id') || '').trim();
  if (!id) return jsonError('id обязателен');

  const file = form.get('file');
  if (!file || !(file instanceof Blob)) return jsonError('file обязателен');

  const contentType = String(file.type || '').toLowerCase();
  if (contentType !== 'image/webp') return jsonError('Разрешён только формат webp');
  if (file.size > MAX_FILE_BYTES) {
    return jsonError(`Файл слишком большой (макс. ${Math.round(MAX_FILE_BYTES / 1024)}KB)`, 413);
  }

  const target = await prisma.user.findUnique({
    where: { id },
    select: { id: true, avatarPath: true, deletedAt: true },
  });
  if (!target || target.deletedAt) return jsonError('Пользователь не найден', 404);

  const relDir = 'uploads/avatars';
  const absDir = path.join(process.cwd(), 'public', relDir);
  await fs.mkdir(absDir, { recursive: true });

  const filename = `${id}.webp`;
  const absPath = path.join(absDir, filename);
  const out = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(absPath, out);

  const avatarPath = `/${relDir}/${filename}?t=${Date.now()}`;
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { avatarPath } });
    await tx.userProfileHistory.create({
      data: {
        userId: id,
        changedById: adminId,
        changes: { avatarPath: { from: target.avatarPath ?? null, to: avatarPath } },
      },
    });
  });

  return NextResponse.json({ ok: true, avatarPath });
}
