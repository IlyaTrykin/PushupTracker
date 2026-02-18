import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, AuthError } from '@/lib/auth';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}


function parseDate(dateStr: string): Date | null {
  // ожидаем YYYY-MM-DD
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function parseTimeHHMM(timeStr: string): { hh: number; mm: number } | null {
  const m = /^(\d{2}):(\d{2})$/.exec(timeStr);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { hh, mm };
}

function combineDateAndTime(date: Date, timeHHMM?: string | null): Date {
  // Если время не передали — берём текущее, но на заданную дату
  const base = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);

  if (!timeHHMM) {
    const now = new Date();
    base.setHours(now.getHours(), now.getMinutes(), 0, 0);
    return base;
  }

  const t = parseTimeHHMM(timeHHMM);
  if (!t) return base;
  base.setHours(t.hh, t.mm, 0, 0);
  return base;
}

function getExerciseTypeFromQuery(request: Request): string | null {
  const url = new URL(request.url);
  const t = url.searchParams.get('exerciseType');
  if (!t) return null;
  // допускаем любые строки, но минимум фильтруем пустое
  return String(t).trim() || null;
}

export async function GET(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const exerciseType = getExerciseTypeFromQuery(request);

  const workouts = await prisma.workout.findMany({
    where: {
      userId,
      ...(exerciseType ? { exerciseType } : {}),
    },
    orderBy: [
      { date: 'desc' },
      { time: 'desc' },
      { id: 'desc' },
    ],
    select: {
      id: true,
      reps: true,
      date: true,
      time: true,
      exerciseType: true,
    },
  });

  return NextResponse.json(workouts);
}

export async function POST(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const reps = Number(body.reps);
  const dateStr = String(body.date || '');
  const timeStr = body.time ? String(body.time) : null;
  const exerciseType = String(body.exerciseType || '').trim();

  if (!Number.isFinite(reps) || reps <= 0) return jsonError('reps должен быть числом > 0');
  const date = parseDate(dateStr);
  if (!date) return jsonError('date должен быть в формате YYYY-MM-DD');
  if (!exerciseType) return jsonError('exerciseType обязателен');

  // date — начало дня, time — дата+время на выбранный день
  const dateMidnight = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const performedAt = (timeStr && timeStr.includes('T'))
    ? new Date(timeStr)
    : combineDateAndTime(date, timeStr);

  const created = await prisma.workout.create({
    data: {
      userId,
      reps,
      exerciseType,
      date: dateMidnight,
      time: performedAt,
    },
    select: { id: true, reps: true, date: true, time: true, exerciseType: true },
  });

  return NextResponse.json(created);
}

export async function PUT(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  const reps = body.reps !== undefined ? Number(body.reps) : undefined;
  const dateStr = body.date !== undefined ? String(body.date) : undefined;
  const timeStr = body.time !== undefined ? String(body.time) : undefined;

  const existing = await prisma.workout.findFirst({
    where: { id, userId },
    select: { id: true, date: true },
  });
  if (!existing) return jsonError('Запись не найдена', 404);

  const data: any = {};

  if (reps !== undefined) {
    if (!Number.isFinite(reps) || reps <= 0) return jsonError('reps должен быть числом > 0');
    data.reps = reps;
  }

  let newDate = existing.date;
  if (dateStr !== undefined) {
    const parsed = parseDate(dateStr);
    if (!parsed) return jsonError('date должен быть в формате YYYY-MM-DD');
    newDate = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    data.date = newDate;
  }

  if (timeStr !== undefined) {
    // time может прийти как ISO (с TZ), либо как HH:MM
    if (timeStr.includes('T')) {
      const dt = new Date(timeStr);
      if (Number.isNaN(dt.getTime())) return jsonError('Некорректное время');
      data.time = dt;
    } else {
      const t = parseTimeHHMM(timeStr);
      if (!t) return jsonError('time должен быть в формате HH:MM');
      data.time = combineDateAndTime(newDate, timeStr);
    }
  }

  const updated = await prisma.workout.update({
    where: { id },
    data,
    select: { id: true, reps: true, date: true, time: true, exerciseType: true },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  let userId: string;
  try {
    userId = (await requireUser(request)).id;
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    return jsonError('Внутренняя ошибка сервера', 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return jsonError('Некорректный JSON');

  const id = String(body.id || '').trim();
  if (!id) return jsonError('id обязателен');

  const existing = await prisma.workout.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!existing) return jsonError('Запись не найдена', 404);

  await prisma.workout.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
