import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ path: string[] }> }
) {
  const { path: parts } = await ctx.params;

  const file = (parts && parts.length ? parts[parts.length - 1] : '').trim();

  // Allow only our generated webp avatar filenames (uuid.webp)
  if (!/^[a-z0-9-]{10,}\.webp$/i.test(file)) {
    return new NextResponse('Not Found', { status: 404 });
  }

  const abs = path.join(process.cwd(), 'public', 'uploads', 'avatars', file);

  try {
    const buf = await fs.readFile(abs);
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        // avoid caching wrong 404 HTML
        'Cache-Control': 'no-store',
      },
    });
  } catch {
    return new NextResponse('Not Found', { status: 404 });
  }
}
