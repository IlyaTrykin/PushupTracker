import { buildAppleAppSiteAssociation } from '@/lib/deep-links';

export const dynamic = 'force-dynamic';

/** Подтверждение universal links для iPhone; без APPLE_TEAM_ID — 404. Content-Type — JSON, без расширения в пути. */
export function GET() {
  const body = buildAppleAppSiteAssociation(process.env);
  if (!body) return new Response('Not found', { status: 404 });
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' },
  });
}
