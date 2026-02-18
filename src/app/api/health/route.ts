import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET() {
  try {
    const count = await prisma.user.count();
    return NextResponse.json({ status: 'ok', users: count });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ status: 'error' }, { status: 500 });
  }
}
