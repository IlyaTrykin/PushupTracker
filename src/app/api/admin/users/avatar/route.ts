import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin as requireAdminUser, AuthError } from '@/lib/auth';
import { AvatarImageError, MAX_AVATAR_UPLOAD_BYTES, normalizeAvatarImage } from '@/lib/avatar-image';
import { saveAvatarFile } from '@/app/uploads/avatars/storage';

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

export async function POST(request: Request) {
  let adminId: string;
  try {
    adminId = (await requireAdminUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Нет доступа', e.status === 401 ? 401 : 403);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  try {
    const form = await request.formData().catch(() => null);
    if (!form) return jsonError('Некорректная форма');

    const id = String(form.get('id') || '').trim();
    if (!id) return jsonError('id обязателен');

    const file = form.get('file');
    if (!file || !(file instanceof Blob)) return jsonError('file обязателен');
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      return jsonError(`Файл слишком большой (макс. ${Math.round(MAX_AVATAR_UPLOAD_BYTES / 1024 / 1024)} МБ)`, 413);
    }

    const target = await prisma.user.findUnique({
      where: { id },
      select: { id: true, avatarPath: true, deletedAt: true },
    });
    if (!target || target.deletedAt) return jsonError('Пользователь не найден', 404);

    // Сигнатура + перекодировка в WebP 256×256 без метаданных (S17).
    const out = await normalizeAvatarImage(Buffer.from(await file.arrayBuffer()));
    const avatarPath = await saveAvatarFile(target.id, out);

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: target.id }, data: { avatarPath } });
      await tx.userProfileHistory.create({
        data: {
          userId: target.id,
          changedById: adminId,
          changes: { avatarPath: { from: target.avatarPath ?? null, to: avatarPath } },
        },
      });
    });

    return NextResponse.json({ ok: true, avatarPath });
  } catch (e) {
    if (e instanceof AvatarImageError) return jsonError('Разрешены только изображения JPEG, PNG, WebP или GIF', 400, 'AVATAR_NOT_IMAGE');
    console.error('ADMIN AVATAR ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
