import { NextResponse } from 'next/server';
import { getVapidPublicKey, isPushConfigured } from '@/lib/web-push';

export async function GET() {
  if (!isPushConfigured()) {
    return NextResponse.json({ enabled: false, error: 'PUSH_NOT_CONFIGURED' }, { status: 200 });
  }
  return NextResponse.json({ enabled: true, publicKey: getVapidPublicKey() });
}
