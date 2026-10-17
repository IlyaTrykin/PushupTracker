'use client';

import { useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { inviteMessages } from '@/i18n/messages/features/invite';
import { nativeAppMessages } from '@/i18n/messages/features/native-app';
import { nativePlatform } from '@/lib/platform';

type InviteInfo = { url: string; joined: number };

export default function InviteFriendCard() {
  const { locale } = useI18n();
  const m = inviteMessages[locale === 'en' ? 'en' : 'ru'];
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/invite', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: InviteInfo) => {
        if (!cancelled) setInfo({ url: d.url, joined: d.joined });
      })
      .catch(() => {
        if (!cancelled) setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const copy = async () => {
    if (!info) return;
    try {
      await navigator.clipboard.writeText(info.url);
      setStatus('copied');
    } catch {
      setStatus('error');
    }
  };

  const share = async () => {
    if (!info) return;
    // App: the system «Поделиться» sheet (@capacitor/share), not copying.
    if (nativePlatform()) {
      try {
        const { Share } = await import('@capacitor/share');
        await Share.share({ title: m.shareTitle, text: m.shareText, url: info.url, dialogTitle: nativeAppMessages[locale === 'en' ? 'en' : 'ru'].shareDialogTitle });
        return;
      } catch (e) {
        if (/cancel/i.test(e instanceof Error ? e.message : String(e))) return; // user closed the sheet
      }
    } else if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: m.shareTitle, text: m.shareText, url: info.url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // user closed the sheet
      }
    }
    await copy();
  };

  return (
    <section style={card} aria-labelledby="invite-friend-title">
      <h2 id="invite-friend-title" style={{ margin: '0 0 6px', fontSize: 18 }}>{m.title}</h2>
      <p style={{ margin: '0 0 12px', color: '#475569', lineHeight: 1.45 }}>{m.text}</p>
      {info ? (
        <>
          <div style={linkRow}>
            <input readOnly value={info.url} style={linkInput} aria-label={m.title} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={copy} style={secondaryBtn}>{m.copy}</button>
          </div>
          <button type="button" onClick={share} style={primaryBtn}>{m.share}</button>
          <div style={{ marginTop: 8, fontSize: 13, color: '#64748b', minHeight: 18 }}>
            {status === 'copied' ? m.copied : info.joined > 0 ? m.joined.replace('{n}', String(info.joined)) : ''}
          </div>
        </>
      ) : status === 'error' ? (
        <div style={{ color: '#b91c1c' }}>{m.loadError}</div>
      ) : null}
    </section>
  );
}

const card: React.CSSProperties = {
  background: 'linear-gradient(135deg, #fff7ed 0%, #ffffff 70%)',
  border: '1px solid #fed7aa',
  borderRadius: 16,
  padding: 14,
  margin: '0 0 12px',
};
const linkRow: React.CSSProperties = { display: 'flex', gap: 8, marginBottom: 8 };
const linkInput: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  padding: '10px 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  fontSize: 14,
  background: '#fff',
  color: '#0f172a',
};
const primaryBtn: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  border: 0,
  borderRadius: 12,
  background: '#ea580c',
  color: '#fff',
  fontWeight: 700,
  fontSize: 16,
  cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
  flex: 'none',
  padding: '0 14px',
  border: '1px solid #cbd5e1',
  borderRadius: 10,
  background: '#fff',
  color: '#0f172a',
  fontWeight: 600,
  cursor: 'pointer',
};
