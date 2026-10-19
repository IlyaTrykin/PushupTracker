'use client';

import type { CSSProperties } from 'react';
import { useI18n } from '@/i18n/provider';
import { BackButton } from '@/components/ui';
import { nativeHealthMessages } from '@/i18n/messages/features/native-health';

/** On the site: the import reads Health on the phone, so there is nothing to do here. */
export default function HealthImportWebPage() {
  const { locale } = useI18n();
  const text = nativeHealthMessages[locale === 'en' ? 'en' : 'ru'];
  return (
    <div className="app-page" style={wrap}>
      <section style={card}>
        <BackButton fallbackHref="/profile" />
        <h1 style={title}>{text.importTitle}</h1>
        <p style={hint}>{text.importWebOnly}</p>
      </section>
    </div>
  );
}

const wrap: CSSProperties = { display: 'grid', gap: 16, maxWidth: 720, margin: '0 auto' };
const card: CSSProperties = { display: 'grid', gap: 12, padding: 'clamp(18px, 3vw, 24px)', borderRadius: 28, border: '1px solid rgba(255, 255, 255, 0.86)', background: 'rgba(255, 255, 255, 0.94)', boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)' };
const title: CSSProperties = { margin: 0, fontSize: 24, fontWeight: 900, color: '#0f172a' };
const hint: CSSProperties = { margin: 0, fontSize: 14, color: '#64748b', lineHeight: 1.5 };
