import { NextResponse } from 'next/server';
import { clearSessionCookie, invalidateSession } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    await invalidateSession(request);
  } finally {
    const res = NextResponse.json({ ok: true });
    clearSessionCookie(res);
    return res;
  }
}
