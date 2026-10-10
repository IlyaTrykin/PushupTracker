import { NextResponse, type NextRequest } from 'next/server';
import { checkApiRequest, guardErrorBody } from '@/lib/request-guard';

/**
 * Next 16 proxy (former middleware): CSRF / Content-Type / body-size guard for `/api/*`.
 * The rules live in `src/lib/request-guard.ts`.
 */
export function proxy(request: NextRequest) {
  const verdict = checkApiRequest({
    method: request.method,
    pathname: request.nextUrl.pathname,
    headers: request.headers,
    appUrl: process.env.APP_URL || null,
  });
  if (verdict.ok) return NextResponse.next();

  const locale = request.cookies.get('preferred_locale')?.value;
  return NextResponse.json(guardErrorBody(verdict.code, locale), { status: verdict.status });
}

export const config = {
  matcher: '/api/:path*',
};
