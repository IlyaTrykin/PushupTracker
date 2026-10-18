import type { Metadata } from 'next';
import { legalMessages } from '@/i18n/messages/features/legal';
import { LegalDocument, legalMetadata, loadLegalContext } from '../privacy/LegalDocument';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const context = await loadLegalContext();
  return legalMetadata(legalMessages[context.locale].terms.metaTitle, context.operator);
}

export default async function TermsPage() {
  const context = await loadLegalContext();
  const m = legalMessages[context.locale].terms;
  return <LegalDocument context={context} title={m.title} updated={m.updated} intro={m.intro} sections={m.sections} />;
}
