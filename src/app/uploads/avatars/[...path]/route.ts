import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { avatarDir } from '../storage';

export const dynamic = 'force-dynamic';

// Файл — всегда картинка: браузер не должен угадывать тип или исполнять содержимое (S17).
const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
} as const;

function notFound() {
  return new NextResponse('Not Found', {
    status: 404,
    headers: { ...SAFE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path: parts } = await ctx.params;

  const file = (parts && parts.length ? parts[parts.length - 1] : '').trim();

  // Allow only our generated webp avatar filenames (uuid.webp)
  if (!/^[a-z0-9-]{10,}\.webp$/i.test(file)) return notFound();

  const abs = path.join(avatarDir(), file);

  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        ...SAFE_HEADERS,
        'Content-Type': 'image/webp',
        // avoid caching wrong 404 HTML
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return notFound();
  }
}
