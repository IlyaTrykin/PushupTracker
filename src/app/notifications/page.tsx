'use client';

import Link from 'next/link';
import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';
import { getUserScopedCacheKey, readCachedValue, writeCachedValue } from '@/lib/client-cache';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

type NotificationsCachePayload = {
  items: NotificationItem[];
  unreadCount: number;
};

type JsonObject = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: JsonObject | null = null;
  if (text) {
    try { data = JSON.parse(text) as JsonObject; } catch {}
  }
  if (!res.ok) {
    const base = typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`;
    const details = typeof data?.details === 'string' ? data.details : '';
    throw new Error(details ? `${base}: ${details}` : base);
  }
  return data;
}

export default function NotificationsPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = (input: string) => t(locale, input);
  const cacheKey = useMemo(() => getUserScopedCacheKey('notifications', user?.id, user?.username), [user?.id, user?.username]);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const applyPayload = useCallback((payload: NotificationsCachePayload) => {
    setItems(Array.isArray(payload.items) ? payload.items : []);
    setUnreadCount(typeof payload.unreadCount === 'number' ? payload.unreadCount : 0);
  }, []);

  const load = useCallback(async ({ preferCache = false }: { preferCache?: boolean } = {}) => {
    const cached = preferCache ? readCachedValue<NotificationsCachePayload>(cacheKey) : null;
    setLoading(!cached);
    setError(null);
    setInfo(null);
    if (cached) applyPayload(cached);
    try {
      const data = await fetchJsonSafe('/api/notifications');
      const payload: NotificationsCachePayload = {
        items: Array.isArray(data?.items) ? (data.items as NotificationItem[]) : [],
        unreadCount: typeof data?.unreadCount === 'number' ? data.unreadCount : 0,
      };
      applyPayload(payload);
      writeCachedValue(cacheKey, payload);
    } catch (e: unknown) {
      if (!cached) setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [applyPayload, cacheKey]);

  useEffect(() => { void load({ preferCache: true }); }, [load]);

  const markRead = async (id: string) => {
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  const markAllRead = async () => {
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe('/api/notifications/mark-read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      setInfo(tt('Отмечено как прочитанное'));
      await load();
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  return (
    <div className="app-page" style={page}>
      <section style={heroCard}>
        <div style={heroCopy}>
          <div style={eyebrow}>{tt('Центр уведомлений')}</div>
          <h1 style={heroTitle}>{tt('Уведомления')}</h1>
          <p style={heroText}>{tt('Все системные события, приглашения и обновления собраны в одном потоке.')}</p>
        </div>
        <div style={heroActions}>
          <Link href="/" style={linkButton}>← {tt('На главную')}</Link>
          <button type="button" onClick={() => void load()} style={btnSecondary}>{tt('Обновить')}</button>
          <button type="button" onClick={markAllRead} style={btnPrimary}>{tt('Отметить всё прочитанным')}</button>
        </div>
      </section>

      <section style={summaryCard}>
        <div style={summaryLabel}>{tt('Непрочитанных')}</div>
        <div style={summaryValue}>{unreadCount}</div>
      </section>

      {error ? <p style={errorBanner}>{error}</p> : null}
      {info ? <p style={infoBanner}>{info}</p> : null}
      {loading ? <p style={loadingBanner}>{tt('Загрузка…')}</p> : null}

      <div style={listWrap}>
        {items.length === 0 ? (
          <div style={emptyCard}>{tt('Пока уведомлений нет.')}</div>
        ) : (
          items.map((n) => (
            <article
              key={n.id}
              style={{
                ...notificationCard,
                background: n.isRead
                  ? 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.88) 100%)'
                  : 'linear-gradient(180deg, rgba(255, 247, 237, 0.96) 0%, rgba(255, 255, 255, 0.92) 100%)',
                borderColor: n.isRead ? 'rgba(226, 232, 240, 0.95)' : 'rgba(251, 146, 60, 0.28)',
              }}
            >
              <div style={notificationHead}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={titleRow}>
                    <div style={notificationTitle}>{n.title}</div>
                    {!n.isRead ? <span style={pill}>{tt('Новое')}</span> : null}
                  </div>
                  <div style={metaLine}>
                    {new Date(n.createdAt).toLocaleString(localeTag)} · <span style={metaStrong}>{tt(n.type)}</span>
                  </div>
                  {n.body ? <div style={notificationBody}>{tt(n.body)}</div> : null}
                  {n.link ? (
                    <div>
                      <Link href={n.link} style={linkInline}>{tt('Открыть')}</Link>
                    </div>
                  ) : null}
                </div>

                {!n.isRead ? (
                  <div style={{ display: 'flex', alignItems: 'center' }}>
                    <button type="button" onClick={() => markRead(n.id)} style={btnSecondary}>
                      {tt('Прочитано')}
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>
    </div>
  );
}

const page: CSSProperties = {
  display: 'grid',
  gap: 18,
  maxWidth: 980,
};

const heroCard: CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 'clamp(18px, 3vw, 28px)',
  borderRadius: 30,
  border: '1px solid rgba(251, 146, 60, 0.24)',
  background:
    'radial-gradient(circle at top right, rgba(251, 146, 60, 0.16), transparent 28%), linear-gradient(145deg, rgba(255, 250, 243, 0.96) 0%, rgba(255, 255, 255, 0.92) 52%, rgba(239, 246, 255, 0.9) 100%)',
  boxShadow: '0 28px 80px rgba(15, 23, 42, 0.12)',
};

const heroCopy: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const eyebrow: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: '#c2410c',
};

const heroTitle: CSSProperties = {
  margin: 0,
  color: '#0f172a',
  fontSize: 'clamp(28px, 4vw, 42px)',
  lineHeight: 0.98,
  fontWeight: 900,
  letterSpacing: '-0.05em',
};

const heroText: CSSProperties = {
  margin: 0,
  maxWidth: 620,
  color: '#475569',
  lineHeight: 1.6,
};

const heroActions: CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const summaryCard: CSSProperties = {
  display: 'grid',
  gap: 4,
  padding: '18px 20px',
  borderRadius: 24,
  border: '1px solid rgba(255, 255, 255, 0.84)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 20px 50px rgba(15, 23, 42, 0.08)',
};

const summaryLabel: CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#94a3b8',
};

const summaryValue: CSSProperties = {
  fontSize: 'clamp(28px, 5vw, 42px)',
  lineHeight: 1,
  fontWeight: 900,
  letterSpacing: '-0.05em',
  color: '#0f172a',
};

const listWrap: CSSProperties = {
  display: 'grid',
  gap: 12,
};

const notificationCard: CSSProperties = {
  padding: 18,
  borderRadius: 24,
  border: '1px solid rgba(226, 232, 240, 0.95)',
  boxShadow: '0 18px 42px rgba(15, 23, 42, 0.08)',
};

const notificationHead: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 16,
  flexWrap: 'wrap',
};

const titleRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  flexWrap: 'wrap',
};

const notificationTitle: CSSProperties = {
  fontWeight: 900,
  fontSize: 18,
  color: '#0f172a',
};

const metaLine: CSSProperties = {
  fontSize: 12,
  color: '#64748b',
};

const metaStrong: CSSProperties = {
  fontWeight: 800,
  color: '#475569',
};

const notificationBody: CSSProperties = {
  color: '#334155',
  lineHeight: 1.6,
};

const pill: CSSProperties = {
  padding: '6px 10px',
  borderRadius: 999,
  background: 'rgba(249, 115, 22, 0.12)',
  color: '#c2410c',
  fontSize: 12,
  fontWeight: 800,
};

const linkInline: CSSProperties = {
  color: '#c2410c',
  fontWeight: 800,
  textDecoration: 'none',
};

const emptyCard: CSSProperties = {
  padding: '20px 22px',
  borderRadius: 22,
  border: '1px dashed rgba(148, 163, 184, 0.35)',
  color: '#64748b',
  background: 'rgba(255, 255, 255, 0.56)',
};

const errorBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.34)',
  color: '#b91c1c',
  fontWeight: 700,
};

const infoBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(220, 252, 231, 0.92)',
  border: '1px solid rgba(34, 197, 94, 0.24)',
  color: '#166534',
  fontWeight: 700,
};

const loadingBanner: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  border: '1px solid rgba(226, 232, 240, 0.92)',
  background: 'rgba(255, 255, 255, 0.8)',
  color: '#475569',
  fontWeight: 700,
};

const btnPrimary: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  boxShadow: '0 16px 30px rgba(234, 88, 12, 0.24)',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};

const btnSecondary: CSSProperties = {
  padding: '10px 14px',
  borderRadius: 14,
  border: '1px solid rgba(148, 163, 184, 0.24)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#0f172a',
  cursor: 'pointer',
  fontWeight: 800,
};

const linkButton: CSSProperties = {
  ...btnSecondary,
  textDecoration: 'none',
};
