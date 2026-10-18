import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import AdminReportsClient from './AdminReportsClient';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const metadata = { robots: { index: false } };

/** /admin/reports — reports on users (R33), admins only; others get 404 as on /admin/users. */
export default async function AdminReportsPage() {
  const cookieStore = await cookies();
  const user = await getAuthUserFromSessionToken(cookieStore.get('session')?.value);
  if (!user?.isAdmin) notFound();
  return <AdminReportsClient />;
}
