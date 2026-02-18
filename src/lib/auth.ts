import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

/** Unified auth helpers for API routes. */

export class AuthError extends Error {
  public status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export type AuthUser = {
  id: string;
  username: string;
  email: string | null;
  isAdmin: boolean;
};

function parseCookieHeader(cookieHeader: string, name: string): string | null {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ?? null;
}

export function getSessionToken(request: Request): string | null {
  const anyReq: any = request as any;
  try {
    const v = anyReq?.cookies?.get?.('session')?.value;
    if (typeof v === 'string' && v) return v;
  } catch {
    // ignore
  }

  const cookieHeader = request.headers.get('cookie') || '';
  const token = parseCookieHeader(cookieHeader, 'session');
  return token || null;
}

function isHttps(request: Request): boolean {
  const xfProto = request.headers.get('x-forwarded-proto');
  if (xfProto) return xfProto.includes('https');
  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return false;
  }
}

export async function getAuthUser(request: Request): Promise<AuthUser | null> {
  const token = getSessionToken(request);
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { token },
    select: {
      token: true,
      expiresAt: true,
      user: { select: { id: true, username: true, email: true, isAdmin: true, deletedAt: true } },
    },
  });

  if (!session?.user) return null;

  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => {});
    return null;
  }

  // Soft-deleted accounts are treated as logged out.
  if ((session.user as any).deletedAt) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => {});
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    email: session.user.email ?? null,
    isAdmin: Boolean((session.user as any).isAdmin),
  };
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const u = await getAuthUser(request);
  if (!u) throw new AuthError('UNAUTHORIZED', 401);
  return u;
}

export async function requireAdmin(request: Request): Promise<AuthUser> {
  const u = await requireUser(request);
  if (!u.isAdmin) throw new AuthError('FORBIDDEN', 403);
  return u;
}

export async function invalidateSession(request: Request): Promise<void> {
  const token = getSessionToken(request);
  if (!token) return;
  await prisma.session.deleteMany({ where: { token } }).catch(() => {});
}

export function setSessionCookie(
  res: NextResponse,
  token: string,
  request: Request,
  maxAgeSeconds = 60 * 60 * 24 * 30,
): void {
  res.cookies.set('session', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isHttps(request),
    path: '/',
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set('session', '', {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export function authJsonError(err: unknown): NextResponse | null {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  return null;
}
