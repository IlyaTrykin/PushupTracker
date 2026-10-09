import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import AdminUsersClient from './AdminUsersClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function isAdminFromCookies(): Promise<boolean> {
  const cookieStore = await cookies(); // важно: await в Next.js 16
  // Session by token hash; expired sessions and deleted users are rejected (as in requireAdmin).
  const user = await getAuthUserFromSessionToken(cookieStore.get('session')?.value);
  return Boolean(user?.isAdmin);
}

export default async function AdminUsersPage() {
  const ok = await isAdminFromCookies();
  if (!ok) notFound();

  return <AdminUsersClient />;
}
