import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getCurrentUserId() {
  const store = await cookies();
  const token = store.get('session')?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({ where: { token } });
  return session?.userId ?? null;
}

export default async function HomePage() {
  const userId = await getCurrentUserId();
  redirect(userId ? '/dashboard' : '/login');
}
