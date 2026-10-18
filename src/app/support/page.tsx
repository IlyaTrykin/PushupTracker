import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { legalMessages } from '@/i18n/messages/features/legal';
import { LegalDocument, LegalSections, legalMetadata, loadLegalContext } from '../privacy/LegalDocument';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const context = await loadLegalContext();
  return legalMetadata(legalMessages[context.locale].support.metaTitle, context.operator);
}

export default async function SupportPage() {
  const context = await loadLegalContext();
  const { fill, operator, labels } = context;
  const m = labels.support;
  return (
    <LegalDocument context={context} title={m.title} intro={m.intro}>
      <section style={block}>
        <h2 style={h2}>{m.contactTitle}</h2>
        <p style={text}>{fill(m.contactText)}</p>
        {operator.email ? (
          <p style={text}>
            <a href={`mailto:${operator.email}`} style={link}>{fill(labels.writeToUs)}</a>
          </p>
        ) : null}
      </section>
      <h2 style={h2}>{m.faqTitle}</h2>
      <LegalSections sections={m.faq} fill={fill} />
      <p style={text}>
        <a href="/account-deletion" style={link}>{m.deletionLink}</a>
      </p>
    </LegalDocument>
  );
}

const block: CSSProperties = { display: 'grid', gap: 8 };
const h2: CSSProperties = { margin: 0, fontSize: 19, fontWeight: 700 };
const text: CSSProperties = { margin: 0, lineHeight: 1.55, opacity: 0.92 };
const link: CSSProperties = { color: 'inherit', fontWeight: 700 };
