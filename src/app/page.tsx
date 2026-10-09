import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getAuthUserFromSessionToken } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function HomePage() {
  const store = await cookies();
  // Same check as the API: session by token hash, not expired, user not deleted.
  const user = await getAuthUserFromSessionToken(store.get('session')?.value);
  redirect(user ? '/dashboard' : '/login');
}
