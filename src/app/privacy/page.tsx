import type { Metadata } from 'next';
import { privacyMessages } from '@/i18n/messages/features/privacy';
import { LegalDocument, legalMetadata, loadLegalContext } from './LegalDocument';

// Operator data comes from env at request time; the page must never be prerendered at build.
export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const context = await loadLegalContext();
  return legalMetadata(privacyMessages[context.locale].metaTitle, context.operator);
}

export default async function PrivacyPage() {
  const context = await loadLegalContext();
  const m = privacyMessages[context.locale];
  return <LegalDocument context={context} title={m.title} updated={m.updated} intro={m.intro} sections={m.sections} />;
}
