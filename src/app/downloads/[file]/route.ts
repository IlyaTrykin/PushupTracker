import path from 'path';
import { createReadStream, promises as fs } from 'fs';
import { Readable } from 'stream';
import { downloadsDir, resolveDownload } from '@/lib/downloads';

export const dynamic = 'force-dynamic';

// Файл только скачивается: браузер не угадывает тип и ничего из него не исполняет.
const SAFE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'",
} as const;

function notFound() {
  return new Response('Not Found', {
    status: 404,
    headers: { ...SAFE_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

/** Прямая ссылка на файл из тома загрузок (APK для тестеров); на сайте не показывается. */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const download = resolveDownload(file);
  if (!download) return notFound();

  const abs = path.join(downloadsDir(), download.fileName);
  let size: number;
  try {
    const stat = await fs.stat(abs);
    if (!stat.isFile()) return notFound();
    size = stat.size;
  } catch {
    return notFound();
  }

  const body = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
  return new Response(body, {
    status: 200,
    headers: {
      ...SAFE_HEADERS,
      'Content-Type': download.contentType,
      'Content-Length': String(size),
      'Content-Disposition': `attachment; filename="${download.fileName}"`,
      // Новая версия кладётся под тем же именем — без долгого кэша.
      'Cache-Control': 'no-cache',
    },
  });
}
