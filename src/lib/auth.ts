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
  language: string;
};

type RequestWithOptionalCookies = Request & {
  cookies?: {
    get?: (name: string) => { value?: string } | undefined;
  };
};

const authUserSelect = {
  id: true,
  username: true,
  email: true,
  isAdmin: true,
  language: true,
  deletedAt: true,
} as const;

async function getAuthUserByToken(token: string): Promise<AuthUser | null> {
  const session = await prisma.session.findUnique({
    where: { token },
    select: {
      token: true,
      expiresAt: true,
      user: { select: authUserSelect },
    },
  });

  if (!session?.user) return null;

  if (session.expiresAt && session.expiresAt.getTime() < Date.now()) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => {});
    return null;
  }

  if (session.user.deletedAt) {
    await prisma.session.deleteMany({ where: { token } }).catch(() => {});
    return null;
  }

  return {
    id: session.user.id,
    username: session.user.username,
    email: session.user.email ?? null,
    isAdmin: session.user.isAdmin,
    language: session.user.language || 'ru',
  };
}

function parseCookieHeader(cookieHeader: string, name: string): string | null {
  const m = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m?.[1] ?? null;
}

export function getSessionToken(request: Request): string | null {
  const requestWithCookies = request as RequestWithOptionalCookies;
  try {
    const v = requestWithCookies.cookies?.get?.('session')?.value;
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
  return getAuthUserByToken(token);
}

export async function getAuthUserFromSessionToken(token: string | null | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  return getAuthUserByToken(token);
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
