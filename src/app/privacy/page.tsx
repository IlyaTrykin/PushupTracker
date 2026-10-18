import type { CSSProperties } from 'react';
import type { Metadata } from 'next';
import { getRequestLocale } from '@/i18n/server';
import { privacyMessages } from '@/i18n/messages/features/privacy';

export const dynamic = 'force-dynamic';

// DRAFT: not indexed until the placeholders are filled in and the text is reviewed.
export async function generateMetadata(): Promise<Metadata> {
  const m = privacyMessages[await getRequestLocale()];
  return { title: { absolute: m.metaTitle }, robots: { index: false } };
}

export default async function PrivacyPage() {
  const m = privacyMessages[await getRequestLocale()];
  return (
    <main style={page}>
      <div style={badge}>{m.draftBadge}</div>
      <h1 style={h1}>{m.title}</h1>
      <p style={muted}>{m.updated}</p>
      <p style={text}>{m.intro}</p>
      {m.sections.map((section) => (
        <section key={section.title} style={block}>
          <h2 style={h2}>{section.title}</h2>
          {section.paragraphs?.map((p) => (
            <p key={p} style={text}>{p}</p>
          ))}
          {section.items ? (
            <ul style={list}>
              {section.items.map((item) => (
                <li key={item} style={text}>{item}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </main>
  );
}

const page: CSSProperties = { maxWidth: 760, display: 'grid', gap: 14, padding: '8px 0 40px' };
const badge: CSSProperties = {
  justifySelf: 'start',
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid rgba(251, 146, 60, 0.5)',
  background: 'rgba(251, 146, 60, 0.12)',
  color: '#fdba74',
  fontWeight: 700,
  fontSize: 13,
};
const h1: CSSProperties = { margin: 0, fontSize: 'clamp(26px, 5vw, 36px)', fontWeight: 800 };
const h2: CSSProperties = { margin: 0, fontSize: 19, fontWeight: 700 };
const block: CSSProperties = { display: 'grid', gap: 8 };
const text: CSSProperties = { margin: 0, lineHeight: 1.55, opacity: 0.92 };
const muted: CSSProperties = { margin: 0, opacity: 0.6, fontSize: 14 };
const list: CSSProperties = { margin: 0, paddingLeft: 20, display: 'grid', gap: 6 };
