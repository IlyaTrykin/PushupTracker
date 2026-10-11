import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Landing from '@/components/landing/Landing';
import { getRequestLocale } from '@/i18n/server';
import { landingMessages } from '@/i18n/messages/features/landing';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import { publicAppUrl } from '@/lib/public-url';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function generateMetadata(): Promise<Metadata> {
  const m = landingMessages[await getRequestLocale()];
  return { title: { absolute: m.metaTitle }, description: m.metaDescription, alternates: { canonical: '/' } };
}

export default async function HomePage() {
  const store = await cookies();
  // Same check as the API: session by token hash, not expired, user not deleted.
  const user = await getAuthUserFromSessionToken(store.get('session')?.value);
  if (user) redirect('/dashboard');
  return <Landing locale={await getRequestLocale()} appUrl={publicAppUrl()} />;
}
