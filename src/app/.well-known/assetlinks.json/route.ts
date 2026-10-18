import { buildAssetLinks } from '@/lib/deep-links';

export const dynamic = 'force-dynamic';

/** Подтверждение App Links для Android; без ANDROID_CERT_SHA256 — 404. */
export function GET() {
  const body = buildAssetLinks(process.env);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}
