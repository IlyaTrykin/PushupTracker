import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import AdminUsersClient from './AdminUsersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function isAdminFromCookies(): Promise<boolean> {
  const cookieStore = await cookies(); // важно: await в Next.js 16
  const token = cookieStore.get('session')?.value;
  if (!token) return false;

  const session = await prisma.session.findUnique({ where: { token } });
  if (!session) return false;

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return false;

  return Boolean(user.isAdmin);
}

export default async function AdminUsersPage() {
  const ok = await isAdminFromCookies();
  if (!ok) notFound();

  return <AdminUsersClient />;
}
