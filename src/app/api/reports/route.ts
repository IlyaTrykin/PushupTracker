import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { hitRateLimit, tooManyRequests } from '@/lib/rate-limit';
import { sendReportEmail, submitReport } from '@/lib/reports';

export const dynamic = 'force-dynamic';

/**
 * POST /api/reports { targetUserId, context: 'profile'|'group'|'reaction', contextId?, reason, text? }
 * → { ok, id }. Stored, mailed to FEEDBACK_TO, shown in /admin/reports; 10 an hour per user.
 */
export async function POST(request: NextRequest) {
  try {
    const me = await requireUser(request);
    const body = await request.json().catch(() => null);
    const result = await submitReport(me, body, {
      db: prisma,
      hitRateLimit,
      sendReportEmail: (data) => sendReportEmail(data, request),
    });
    if (result.ok) return NextResponse.json({ ok: true, id: result.id });
    if (result.status === 429) return tooManyRequests(result.retryAfterSeconds, me.language);
    return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    console.error('REPORTS POST ERROR:', e);
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }
}
