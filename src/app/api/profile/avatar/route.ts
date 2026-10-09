import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import { AvatarImageError, MAX_AVATAR_UPLOAD_BYTES, normalizeAvatarImage } from '@/lib/avatar-image';
import { saveAvatarFile } from '@/app/uploads/avatars/storage';

function jsonError(message: string, status = 400, code?: string) {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

// Аватар хранится локально. Сервер не доверяет ни заявленному MIME, ни байтам клиента (S17):
// проверяет сигнатуру и перекодирует в WebP 256×256 без метаданных.
export async function POST(request: Request) {
  try {
    const me = await requireUser(request);

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError('Некорректная форма');

    const file = form.get('file');
    if (!file || !(file instanceof Blob)) return jsonError('file обязателен');
    if (file.size > MAX_AVATAR_UPLOAD_BYTES) {
      return jsonError(`Файл слишком большой (макс. ${Math.round(MAX_AVATAR_UPLOAD_BYTES / 1024 / 1024)} МБ)`, 413);
    }

    const out = await normalizeAvatarImage(Buffer.from(await file.arrayBuffer()));
    const avatarPath = await saveAvatarFile(me.id, out);

    await prisma.$transaction(async (tx) => {
      const prev = await tx.user.findUnique({ where: { id: me.id }, select: { avatarPath: true } });
      await tx.user.update({ where: { id: me.id }, data: { avatarPath } });
      await tx.userProfileHistory.create({
        data: {
          userId: me.id,
          changedById: me.id,
          changes: { avatarPath: { from: prev?.avatarPath ?? null, to: avatarPath } },
        },
      });
    });

    return NextResponse.json({ ok: true, avatarPath });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof AvatarImageError) return jsonError('Разрешены только изображения JPEG, PNG, WebP или GIF', 400, 'AVATAR_NOT_IMAGE');
    console.error('PROFILE AVATAR ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
