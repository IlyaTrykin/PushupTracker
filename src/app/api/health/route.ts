import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// Мониторинг смотрит только на 200; никаких метрик наружу (S21/P03).
export async function GET() {
  return NextResponse.json({ status: 'ok' });
}
