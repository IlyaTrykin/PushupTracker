'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
};

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    const base = data?.error || `Ошибка (код ${res.status})`;
    const details = data?.details || '';
    throw new Error(details ? `${base}: ${details}` : base);
  }
  return data;
}

export default function NotificationsPage() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const data = await fetchJsonSafe('/api/notifications');
      setItems(data.items || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

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
    } catch (e: any) {
      setError(e?.message ?? String(e));
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
      setInfo('Отмечено как прочитанное');
      await load();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div style={{ maxWidth: 900, margin: '40px auto', fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link href="/" style={{ textDecoration: 'none' }}>← На главную</Link>
      </div>

      <div style={{ marginTop: 10, color: '#6b7280' }}>
        Непрочитанных: <b>{unreadCount}</b>
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
        <button type="button" onClick={load} style={btnSecondary}>Обновить</button>
        <button type="button" onClick={markAllRead} style={btnPrimary}>Отметить всё прочитанным</button>
      </div>

      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      {info && <p style={{ color: 'green', marginTop: 12 }}>{info}</p>}
      {loading && <p style={{ marginTop: 12 }}>Загрузка…</p>}

      <div style={{ marginTop: 16, display: 'grid', gap: 10 }}>
        {items.length === 0 ? (
          <div style={{ color: '#6b7280' }}>Пока уведомлений нет.</div>
        ) : (
          items.map(n => (
            <div
              key={n.id}
              style={{
                padding: 12,
                borderRadius: 10,
                border: '1px solid #e5e7eb',
                background: n.isRead ? '#fff' : '#fefce8',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontWeight: 900 }}>{n.title}</div>
                  <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                    {new Date(n.createdAt).toLocaleString()} · <span style={{ fontWeight: 700 }}>{n.type}</span>
                  </div>
                  {n.body && <div style={{ marginTop: 8 }}>{n.body}</div>}
                  {n.link && (
                    <div style={{ marginTop: 8 }}>
                      <Link href={n.link} style={{ textDecoration: 'none' }}>Открыть</Link>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!n.isRead && (
                    <button type="button" onClick={() => markRead(n.id)} style={btnSecondary}>
                      Прочитано
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const btnPrimary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
};
