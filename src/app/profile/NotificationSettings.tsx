'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { base64ToUint8Array, setPushWanted } from '@/components/RegisterSW';
import { TELEGRAM_LINK_EVENT } from '@/components/TelegramConnect';

type PushKeyResponse = { enabled: boolean; publicKey?: string; error?: string };
type Channel = 'pushEnabled' | 'emailEnabled' | 'telegramEnabled';
type PreferenceRow = {
  eventType: string;
  label: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
  telegramEnabled: boolean;
};
type PreferencesResponse = { items?: PreferenceRow[]; telegramAvailable?: boolean; error?: string };

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function readPreferences(data: PreferencesResponse): { rows: PreferenceRow[]; telegramAvailable: boolean } {
  const rows = Array.isArray(data.items)
    ? data.items.map((row) => ({ ...row, telegramEnabled: Boolean(row.telegramEnabled) }))
    : [];
  return { rows, telegramAvailable: Boolean(data.telegramAvailable) };
}

/**
 * Notification settings in the profile: this device's push subscription and, per event,
 * push / e-mail / Telegram switches. The Telegram column appears only when the bot is on
 * (`telegramAvailable` from `/api/push/preferences`) and this account has a linked chat
 * (`/api/profile/telegram`, kept in sync with the Telegram section via `TELEGRAM_LINK_EVENT`).
 */
export default function NotificationSettings() {
  const { messages } = useI18n();
  const { user } = useAuth();
  const [supported, setSupported] = useState(false);
  const [requiresSecureContext, setRequiresSecureContext] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingEvent, setSavingEvent] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<PreferenceRow[]>([]);
  const [telegramAvailable, setTelegramAvailable] = useState(false);
  const [telegramLinked, setTelegramLinked] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasRequiredApis = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    const secureContextRequired = !window.isSecureContext
      && window.location.hostname !== 'localhost'
      && window.location.hostname !== '127.0.0.1';
    setRequiresSecureContext(secureContextRequired);
    setSupported(hasRequiredApis && !secureContextRequired);
  }, []);

  // E-mail and Telegram settings do not depend on browser push support.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/push/preferences', { cache: 'no-store', credentials: 'include' });
        const data = (await res.json().catch(() => ({}))) as PreferencesResponse;
        if (!res.ok) throw new Error(data.error || messages.push.loadError);
        const next = readPreferences(data);
        setRows(next.rows);
        setTelegramAvailable(next.telegramAvailable);
      } catch {
        setMessage(messages.push.loadError);
      }
    })();
  }, [messages.push.loadError]);

  useEffect(() => {
    if (!telegramAvailable) return;
    let cancelled = false;
    fetch('/api/profile/telegram', { cache: 'no-store', credentials: 'include' })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as { linked?: boolean } | null;
        if (!cancelled) setTelegramLinked(res.ok && Boolean(data?.linked));
      })
      .catch(() => {});
    const onLinkChange = (event: Event) => {
      setTelegramLinked(Boolean((event as CustomEvent<{ linked?: boolean }>).detail?.linked));
    };
    window.addEventListener(TELEGRAM_LINK_EVENT, onLinkChange);
    return () => {
      cancelled = true;
      window.removeEventListener(TELEGRAM_LINK_EVENT, onLinkChange);
    };
  }, [telegramAvailable]);

  useEffect(() => {
    if (!supported) return;
    (async () => {
      try {
        const keyRes = await fetch('/api/push/public-key', { cache: 'no-store' });
        const keyData = (await keyRes.json()) as PushKeyResponse;
        setConfigured(Boolean(keyData.enabled));
        setPublicKey(String(keyData.publicKey || ''));

        const stRes = await fetch('/api/push/subscriptions', { cache: 'no-store', credentials: 'include' });
        const stData = await stRes.json().catch(() => ({}));
        setEnabled(Boolean(stData.enabled));
      } catch {
        setMessage(messages.push.loadError);
      }
    })();
  }, [messages.push.loadError, supported]);

  async function updateRow(row: PreferenceRow, channel: Channel, value: boolean) {
    setMessage(null);
    setSavingEvent(row.eventType);
    try {
      const res = await fetch('/api/push/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ eventType: row.eventType, [channel]: value }),
      });
      const data = (await res.json().catch(() => ({}))) as PreferencesResponse;
      if (!res.ok) throw new Error(data.error || messages.push.saveError);
      if (Array.isArray(data.items)) {
        const next = readPreferences(data);
        setRows(next.rows);
        setTelegramAvailable(next.telegramAvailable);
      } else {
        setRows((prev) => prev.map((r) => (r.eventType === row.eventType ? { ...r, [channel]: value } : r)));
      }
    } catch (e) {
      setMessage(getErrorMessage(e, messages.push.saveError));
    } finally {
      setSavingEvent('');
    }
  }

  async function enablePush() {
    setMessage(null);
    if (!supported) {
      setMessage(messages.push.browserNoPush);
      return;
    }
    if (!configured || !publicKey) {
      setMessage(messages.push.serverNotConfigured);
      return;
    }

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setMessage(messages.push.permissionDenied);
        return;
      }

      const reg = await navigator.serviceWorker.ready;
      let subscription = await reg.pushManager.getSubscription();
      if (!subscription) {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: base64ToUint8Array(publicKey),
        });
      }

      const res = await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(subscription.toJSON()),
      });
      if (!res.ok) {
        // The server did not accept the subscription: drop it here too, or the browser would
        // think push is on while this device gets nothing.
        await subscription.unsubscribe().catch(() => {});
        setMessage(messages.push.enableError);
        return;
      }

      setPushWanted(user?.id, true);
      setEnabled(true);
      setMessage(messages.push.enabled);
    } catch {
      setMessage(messages.push.enableError);
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setMessage(null);
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const subscription = await reg.pushManager.getSubscription();
      const endpoint = subscription?.endpoint;
      if (subscription) await subscription.unsubscribe().catch(() => {});
      await fetch('/api/push/subscriptions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(endpoint ? { endpoint } : {}),
      });

      setPushWanted(user?.id, false);
      setEnabled(false);
      setMessage(messages.push.disabled);
    } catch {
      setMessage(messages.push.disableError);
    } finally {
      setBusy(false);
    }
  }

  const columns: Array<{ key: Channel; label: string }> = [
    { key: 'pushEnabled', label: messages.push.pushColumn },
    { key: 'emailEnabled', label: messages.push.emailColumn },
    ...(telegramAvailable && telegramLinked ? [{ key: 'telegramEnabled' as const, label: messages.push.telegramColumn }] : []),
  ];
  const eventLabels: Record<string, string> = messages.push.events;

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {supported ? (
        <>
          <div style={hint}>
            {messages.push.statusLabel}: {enabled ? messages.push.statusEnabled : messages.push.statusDisabled}
            {configured ? '' : messages.push.statusServerNotConfigured}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {!enabled ? (
              <button type="button" disabled={busy || !configured} onClick={enablePush} style={enableButton}>
                {messages.push.enableButton}
              </button>
            ) : (
              <button type="button" disabled={busy} onClick={disablePush} style={disableButton}>
                {messages.push.disableButton}
              </button>
            )}
          </div>
        </>
      ) : (
        <div style={hint}>
          {requiresSecureContext ? messages.push.browserSecureOnly : messages.push.browserUnsupported}
        </div>
      )}

      <div style={{ fontWeight: 800 }}>{messages.push.settingsTitle}</div>

      {rows.length === 0 ? (
        <div style={hint}>{messages.push.noEvents}</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ ...headCell, textAlign: 'left' }}>{messages.push.eventColumn}</th>
                {columns.map((c) => (
                  <th key={c.key} style={headCell}>{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowBusy = savingEvent === row.eventType;
                return (
                  <tr key={row.eventType}>
                    <td style={{ ...bodyCell, textAlign: 'left' }}>{eventLabels[row.eventType] || row.label}</td>
                    {columns.map((c) => (
                      <td key={c.key} style={bodyCell}>
                        <input
                          type="checkbox"
                          aria-label={`${eventLabels[row.eventType] || row.label}: ${c.label}`}
                          checked={row[c.key]}
                          disabled={rowBusy}
                          onChange={(e) => updateRow(row, c.key, e.target.checked)}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {message ? <div style={{ fontSize: 13 }}>{message}</div> : null}
    </div>
  );
}

const hint: CSSProperties = { fontSize: 13, color: '#6b7280' };

const enableButton: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #2563eb',
  background: '#fff',
  color: '#2563eb',
  fontWeight: 800,
};

const disableButton: CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid #ef4444',
  background: '#fff',
  color: '#b91c1c',
  fontWeight: 800,
};

const headCell: CSSProperties = {
  textAlign: 'center',
  padding: '10px 8px',
  borderBottom: '1px solid #e5e7eb',
  whiteSpace: 'nowrap',
};

const bodyCell: CSSProperties = {
  textAlign: 'center',
  padding: '10px 8px',
  borderBottom: '1px solid #f1f5f9',
};
