import { NextResponse } from 'next/server';
import { APP_VERSION } from '@/lib/app-version';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    name: 'pushup-tracker',
    appVersion: APP_VERSION,
    buildTime: process.env.BUILD_TIME || null,
    gitSha: process.env.GIT_SHA || null,
  });
}
