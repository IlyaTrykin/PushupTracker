import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { FEEDBACK_MAX_LENGTH, sendFeedbackEmail } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;
const recentSubmissions = new Map<string, number[]>();

/** Защита от спама: не больше 5 сообщений в минуту на пользователя. */
function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const hits = (recentSubmissions.get(userId) ?? []).filter((ts) => now - ts < RATE_WINDOW_MS);

  if (hits.length >= RATE_LIMIT) {
    recentSubmissions.set(userId, hits);
    return true;
  }

  hits.push(now);
  recentSubmissions.set(userId, hits);
  return false;
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser(request);
  } catch (e) {
    if (e instanceof AuthError) return NextResponse.json({ error: 'Не авторизован' }, { status: e.status });
    return NextResponse.json({ error: 'Внутренняя ошибка сервера' }, { status: 500 });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });

  const message = String((body as Record<string, unknown>).message ?? '').trim();
  if (!message) return NextResponse.json({ error: 'Сообщение не может быть пустым' }, { status: 400 });
  if (message.length > FEEDBACK_MAX_LENGTH) {
    return NextResponse.json({ error: 'Сообщение слишком длинное' }, { status: 400 });
  }

  if (isRateLimited(user.id)) {
    return NextResponse.json({ error: 'Слишком много сообщений, попробуйте позже' }, { status: 429 });
  }

  try {
    const { sent } = await sendFeedbackEmail({
      message,
      username: user.username,
      userEmail: user.email,
      userId: user.id,
      request,
    });

    if (!sent) {
      console.error('FEEDBACK SEND ERROR: почтовый провайдер не настроен');
      return NextResponse.json({ error: 'Отправка почты не настроена' }, { status: 503 });
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('FEEDBACK SEND ERROR:', e);
    return NextResponse.json({ error: 'Не удалось отправить сообщение' }, { status: 502 });
  }
}
