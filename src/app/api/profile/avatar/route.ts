import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';
import path from 'path';
import fs from 'fs/promises';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

// Avatar is stored locally on the server.
// Standardization (256x256 + webp) is enforced on the client side; the server enforces size/type.
const MAX_FILE_BYTES = 300_000; // 300KB (after resize/compress)

export async function POST(request: Request) {
  try {
    const me = await requireUser(request);

    const form = await request.formData().catch(() => null);
    if (!form) return jsonError('Некорректная форма');

    const file = form.get('file');
    if (!file || !(file instanceof Blob)) return jsonError('file обязателен');

    const contentType = String((file as any).type || '').toLowerCase();
    const allowed = new Set(['image/webp', 'image/png', 'image/jpeg', 'image/jpg']);
    if (!allowed.has(contentType)) return jsonError('Разрешены только webp/png/jpeg');
    if (file.size > MAX_FILE_BYTES) return jsonError(`Файл слишком большой (макс. ${Math.round(MAX_FILE_BYTES / 1024)}KB)`, 413);

    const buf = Buffer.from(await file.arrayBuffer());

    // We rely on the client to upload an already standardized avatar (256x256, preferably webp).
    const out = buf;

    const relDir = 'uploads/avatars';
    const absDir = path.join(process.cwd(), 'public', relDir);
    await fs.mkdir(absDir, { recursive: true });

    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/jpeg' || contentType === 'image/jpg' ? 'jpg' : 'webp';
    const filename = `${me.id}.${ext}`;
    const absPath = path.join(absDir, filename);
    await fs.writeFile(absPath, out);

    const avatarPath = `/${relDir}/${filename}?t=${Date.now()}`;

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
  } catch (e: any) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }
}
