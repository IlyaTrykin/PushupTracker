import { NextResponse, type NextRequest } from 'next/server';
import { corsHeaders, parseAllowedOrigins } from '@/lib/cors';
import { checkApiRequest, guardErrorBody } from '@/lib/request-guard';

/**
 * Next 16 proxy (former middleware):
 * - CORS for the native app's origins (`NATIVE_APP_ORIGINS`, see `src/lib/cors.ts`) on `/api/*`
 *   and `/uploads/*`: preflight answered here with 204, other responses get the headers;
 * - CSRF / Content-Type / body-size guard for `/api/*` (rules in `src/lib/request-guard.ts`).
 */
export function proxy(request: NextRequest) {
  const cors = corsHeaders(request.headers.get('origin'), parseAllowedOrigins(process.env.NATIVE_APP_ORIGINS));

  if (cors && request.method === 'OPTIONS') {
    return new NextResponse(null, { status: 204, headers: cors });
  }

  const response = guard(request);
  if (cors) {
    for (const [name, value] of Object.entries(cors)) response.headers.set(name, value);
  }
  return response;
}

function guard(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl;
  if (pathname !== '/api' && !pathname.startsWith('/api/')) return NextResponse.next();

  const verdict = checkApiRequest({
    method: request.method,
    pathname,
    headers: request.headers,
    appUrl: process.env.APP_URL || null,
  });
  if (verdict.ok) return NextResponse.next();

  const locale = request.cookies.get('preferred_locale')?.value;
  return NextResponse.json(guardErrorBody(verdict.code, locale), { status: verdict.status });
}

export const config = {
  matcher: ['/api/:path*', '/uploads/:path*'],
};
