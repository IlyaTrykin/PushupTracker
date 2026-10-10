'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale } from '@/i18n/translate';
import { fillTelegramText, telegramMessages } from '@/i18n/messages/features/telegram';

type LinkState = { linked: boolean; linkedAt: string | null };
type PendingLink = { url: string; expiresAt: number };

const POLL_INTERVAL_MS = 3000;

async function requestJson<T>(url: string, init?: RequestInit): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, { cache: 'no-store', ...init });
  const data = (await res.json().catch(() => null)) as T | null;
  return { status: res.status, data };
}

/**
 * Profile section «Telegram»: one-time link to the bot, waiting for `/start`, disconnect.
 * Renders nothing when the bot is not configured on the server (`/api/profile/telegram` → 404).
 */
export default function TelegramConnect() {
  const { locale } = useI18n();
  const text = telegramMessages[locale];
  const [available, setAvailable] = useState<boolean | null>(null);
  const [state, setState] = useState<LinkState>({ linked: false, linkedAt: null });
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [busy, setBusy] = useState<'connect' | 'disconnect' | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async (): Promise<LinkState | null> => {
    const { status, data } = await requestJson<LinkState>('/api/profile/telegram');
    if (status === 404) {
      setAvailable(false);
      return null;
    }
    if (status !== 200 || !data) throw new Error(text.loadFailed);
    setAvailable(true);
    setState({ linked: Boolean(data.linked), linkedAt: data.linkedAt ?? null });
    return data;
  }, [text.loadFailed]);

  useEffect(() => {
    load().catch(() => setAvailable(false));
  }, [load]);

  // While a link is open, check whether the bot got `/start` (stops when linked or the link expires).
  useEffect(() => {
    if (!pending || state.linked) return;
    const timer = window.setInterval(() => {
      if (Date.now() > pending.expiresAt) {
        setPending(null);
        return;
      }
      if (document.visibilityState !== 'visible') return;
      load()
        .then((next) => {
          if (next?.linked) setPending(null);
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [pending, state.linked, load]);

  async function connect() {
    setBusy('connect');
    setError('');
    try {
      const { status, data } = await requestJson<{ url?: string; expiresAt?: string; error?: string }>('/api/profile/telegram', {
        method: 'POST',
      });
      if (status !== 200 || !data?.url) throw new Error(data?.error || text.connectFailed);
      setPending({ url: data.url, expiresAt: data.expiresAt ? Date.parse(data.expiresAt) : Date.now() + 15 * 60 * 1000 });
    } catch (e) {
      setError(e instanceof Error ? e.message : text.connectFailed);
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setBusy('disconnect');
    setError('');
    try {
      const { status } = await requestJson('/api/profile/telegram', { method: 'DELETE' });
      if (status !== 200) throw new Error(text.disconnectFailed);
      setState({ linked: false, linkedAt: null });
      setPending(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : text.disconnectFailed);
    } finally {
      setBusy(null);
    }
  }

  if (!available) return null;

  const since = state.linkedAt
    ? fillTelegramText(text.connectedSince, {
        date: new Date(state.linkedAt).toLocaleDateString(getIntlLocale(locale), { day: 'numeric', month: 'long', year: 'numeric' }),
      })
    : '';

  return (
    <section style={card} data-testid="telegram-connect">
      <div style={title}>{text.sectionTitle}</div>
      {state.linked ? (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 }}>
            <span style={badge}>✓ {text.connected}</span>
            {since ? <span style={hint}>{since}</span> : null}
          </div>
          <div style={hint}>{text.connectedHint}</div>
          <div>
            <button type="button" onClick={disconnect} disabled={busy !== null} style={{ ...buttonSecondary, opacity: busy ? 0.6 : 1 }}>
              {busy === 'disconnect' ? text.disconnecting : text.disconnect}
            </button>
          </div>
        </>
      ) : (
        <>
          <div style={hint}>{text.sectionHint}</div>
          {pending ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div>
                <a href={pending.url} target="_blank" rel="noopener noreferrer" style={buttonPrimaryLink}>
                  {text.openBot}
                </a>
              </div>
              <div style={hint}>{text.linkHint}</div>
              <div style={{ ...hint, fontWeight: 700 }} aria-live="polite">{text.waiting}</div>
            </div>
          ) : (
            <div>
              <button type="button" onClick={connect} disabled={busy !== null} style={{ ...buttonPrimary, opacity: busy ? 0.6 : 1 }}>
                {busy === 'connect' ? text.connecting : text.connect}
              </button>
            </div>
          )}
        </>
      )}
      {error ? <div style={errorBox} role="alert">{error}</div> : null}
    </section>
  );
}

const card: React.CSSProperties = {
  display: 'grid',
  gap: 14,
  padding: 'clamp(18px, 3vw, 24px)',
  borderRadius: 28,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(240, 249, 255, 0.88) 100%)',
  boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)',
};

const title: React.CSSProperties = { fontSize: 18, fontWeight: 900, color: '#0f172a' };

const hint: React.CSSProperties = { fontSize: 13, color: '#64748b', lineHeight: 1.5 };

const badge: React.CSSProperties = { fontWeight: 900, color: '#0369a1' };

const buttonPrimary: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #38bdf8 0%, #0284c7 100%)',
  boxShadow: '0 16px 30px rgba(2, 132, 199, 0.24)',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer',
};

const buttonPrimaryLink: React.CSSProperties = {
  ...buttonPrimary,
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
  boxSizing: 'border-box',
};

const buttonSecondary: React.CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#0f172a',
  fontWeight: 900,
  cursor: 'pointer',
};

const errorBox: React.CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.34)',
  color: '#b91c1c',
  fontWeight: 700,
};
