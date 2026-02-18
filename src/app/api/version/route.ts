import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({
    name: 'pushup-tracker',
    buildTime: process.env.BUILD_TIME || null,
    gitSha: process.env.GIT_SHA || null,
  });
}
