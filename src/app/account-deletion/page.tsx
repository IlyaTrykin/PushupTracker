import type { Metadata } from 'next';
import { legalMessages } from '@/i18n/messages/features/legal';
import { LegalDocument, legalMetadata, loadLegalContext } from '../privacy/LegalDocument';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const context = await loadLegalContext();
  return legalMetadata(legalMessages[context.locale].deletion.metaTitle, context.operator);
}

export default async function AccountDeletionPage() {
  const context = await loadLegalContext();
  const m = legalMessages[context.locale].deletion;
  return <LegalDocument context={context} title={m.title} intro={m.intro} sections={m.sections} />;
}
