import { NextResponse } from 'next/server';
import { requireUser, AuthError } from '@/lib/auth';
import { prisma } from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const u = await prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        username: true,
        isAdmin: true,
        language: true,
        createdAt: true,
        updatedAt: true,
        gender: true,
        birthDate: true,
        avatarPath: true,
      },
    });

    if (!u) return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401 });

    return NextResponse.json(u);
  } catch (e: unknown) {
    if (e instanceof AuthError) {
      return NextResponse.json({ error: e.message }, { status: e.status });
    }
    return NextResponse.json({ error: 'INTERNAL_ERROR' }, { status: 500 });
  }
}
