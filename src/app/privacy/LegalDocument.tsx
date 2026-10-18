import type { CSSProperties, ReactNode } from 'react';
import type { Metadata } from 'next';
import { getRequestLocale } from '@/i18n/server';
import type { Locale } from '@/i18n/locale';
import { legalMessages } from '@/i18n/messages/features/legal';
import type { LegalSection } from '@/i18n/messages/features/privacy';
import { fillLegal, readLegalOperator, type LegalOperator } from '@/lib/legal';

/**
 * Shared layout of the legal pages. Server component: the operator's name and email come from
 * env at request time (the pages are `force-dynamic`, so they are never baked in at build).
 */
export type LegalContext = {
  locale: Locale;
  operator: LegalOperator;
  labels: (typeof legalMessages)[Locale];
  fill: (text: string) => string;
};

export async function loadLegalContext(): Promise<LegalContext> {
  const locale = await getRequestLocale();
  const operator = readLegalOperator();
  const labels = legalMessages[locale];
  const fill = (text: string) =>
    fillLegal(text, operator, { operator: labels.placeholderOperator, email: labels.placeholderEmail });
  return { locale, operator, labels, fill };
}

/** Metadata: pages are indexed only once the operator is configured. */
export function legalMetadata(title: string, operator: LegalOperator): Metadata {
  return { title: { absolute: title }, robots: { index: operator.configured } };
}

export function LegalSections({ sections, fill }: { sections: readonly LegalSection[]; fill: (text: string) => string }) {
  return (
    <>
      {sections.map((section) => (
        <section key={section.title} style={block}>
          <h2 style={h2}>{section.title}</h2>
          {section.paragraphs?.map((p) => (
            <p key={p} style={text}>{fill(p)}</p>
          ))}
          {section.items ? (
            <ul style={list}>
              {section.items.map((item) => (
                <li key={item} style={text}>{fill(item)}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </>
  );
}

export function LegalDocument({
  context,
  title,
  updated,
  intro,
  sections,
  children,
}: {
  context: LegalContext;
  title: string;
  updated?: string;
  intro: string;
  sections?: readonly LegalSection[];
  children?: ReactNode;
}) {
  const { labels, fill } = context;
  return (
    <main style={page}>
      <h1 style={h1}>{title}</h1>
      {updated ? <p style={muted}>{updated}</p> : null}
      <p style={text}>{fill(intro)}</p>
      {sections ? <LegalSections sections={sections} fill={fill} /> : null}
      {children}
      <nav aria-label={labels.navTitle} style={nav}>
        <a href="/privacy" style={navLink}>{labels.navPrivacy}</a>
        <a href="/terms" style={navLink}>{labels.navTerms}</a>
        <a href="/support" style={navLink}>{labels.navSupport}</a>
        <a href="/account-deletion" style={navLink}>{labels.navDeletion}</a>
      </nav>
    </main>
  );
}

const page: CSSProperties = { maxWidth: 760, display: 'grid', gap: 14, padding: '8px 0 40px' };
const h1: CSSProperties = { margin: 0, fontSize: 'clamp(26px, 5vw, 36px)', fontWeight: 800 };
const h2: CSSProperties = { margin: 0, fontSize: 19, fontWeight: 700 };
const block: CSSProperties = { display: 'grid', gap: 8 };
const text: CSSProperties = { margin: 0, lineHeight: 1.55, opacity: 0.92 };
const muted: CSSProperties = { margin: 0, opacity: 0.6, fontSize: 14 };
const list: CSSProperties = { margin: 0, paddingLeft: 20, display: 'grid', gap: 6 };
const nav: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: '8px 18px', paddingTop: 12, borderTop: '1px solid rgba(148, 163, 184, 0.3)' };
const navLink: CSSProperties = { color: 'inherit', opacity: 0.8, fontSize: 14 };
