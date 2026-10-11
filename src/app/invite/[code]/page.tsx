import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Landing from '@/components/landing/Landing';
import { getRequestLocale } from '@/i18n/server';
import { landingMessages } from '@/i18n/messages/features/landing';
import { getAuthUserFromSessionToken } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { publicAppUrl } from '@/lib/public-url';
import { normalizeInviteCode } from '@/lib/referral';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Params = { params: Promise<{ code: string }> };

async function findInviter(rawCode: string) {
  const code = normalizeInviteCode(decodeURIComponent(rawCode));
  if (!code) return null;
  const user = await prisma.user.findFirst({ where: { inviteCode: code, deletedAt: null }, select: { username: true } });
  return user ? { code, inviterName: user.username } : null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const locale = await getRequestLocale();
  const m = landingMessages[locale];
  const image = { url: `/og-image-${locale}.png`, width: 1200, height: 630 };
  const invite = await findInviter((await params).code);
  if (!invite) return { title: { absolute: m.metaTitle }, robots: { index: false } };
  const title = m.inviteMetaTitle.replace('{name}', invite.inviterName);
  return {
    title: { absolute: title },
    description: m.metaDescription,
    robots: { index: false },
    openGraph: { type: 'website', siteName: m.appName, title, description: m.metaDescription, url: `/invite/${invite.code}`, images: [image] },
    twitter: { card: 'summary_large_image', title, description: m.metaDescription, images: [image.url] },
  };
}

export default async function InvitePage({ params }: Params) {
  const store = await cookies();
  const me = await getAuthUserFromSessionToken(store.get('session')?.value);
  if (me) redirect('/friends');
  const invite = await findInviter((await params).code);
  if (!invite) redirect('/');
  return <Landing locale={await getRequestLocale()} appUrl={publicAppUrl()} invite={invite} />;
}
