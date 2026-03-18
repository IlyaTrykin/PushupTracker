'use client';

import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';

type PushKeyResponse = { enabled: boolean; publicKey?: string; error?: string };
type PreferenceRow = {
  eventType: string;
  label: string;
  pushEnabled: boolean;
  emailEnabled: boolean;
};

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function resolveEventLabel(
  eventType: string,
  fallbackLabel: string,
  eventLabels: Record<string, string>,
) {
  return eventLabels[eventType] || fallbackLabel;
}

function base64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
  return outputArray;
}

export default function PushNotificationsToggle() {
  const { messages } = useI18n();
  const [supported, setSupported] = useState(false);
  const [requiresSecureContext, setRequiresSecureContext] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [publicKey, setPublicKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [savingEvent, setSavingEvent] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<PreferenceRow[]>([]);

  const canEditTable = useMemo(() => rows.length > 0, [rows]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasRequiredApis = 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
    const secureContextRequired = !window.isSecureContext && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1';

    setRequiresSecureContext(secureContextRequired);
    setSupported(hasRequiredApis && !secureContextRequired);
  }, []);

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

      const prefsRes = await fetch('/api/push/preferences', { cache: 'no-store', credentials: 'include' });
      const prefsData = await prefsRes.json().catch(() => ({}));
      setRows(Array.isArray(prefsData.items) ? prefsData.items : []);
    } catch {
      setMessage(messages.push.loadError);
    }
    })();
  }, [messages.push.loadError, supported]);

  async function updateRow(row: PreferenceRow, patch: Partial<PreferenceRow>) {
    setMessage(null);
    setSavingEvent(row.eventType);
    try {
      const res = await fetch('/api/push/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          eventType: row.eventType,
          ...(patch.pushEnabled !== undefined ? { pushEnabled: patch.pushEnabled } : {}),
          ...(patch.emailEnabled !== undefined ? { emailEnabled: patch.emailEnabled } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || messages.push.saveError);

      setRows(Array.isArray(data.items) ? data.items : rows.map((r) => (r.eventType === row.eventType ? { ...r, ...patch } : r)));
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

      await fetch('/api/push/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(subscription.toJSON()),
      });

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

      if (subscription) {
        const endpoint = subscription.endpoint;
        await subscription.unsubscribe().catch(() => {});
        await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ endpoint }),
        });
      } else {
        await fetch('/api/push/subscriptions', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
      }

      setEnabled(false);
      setMessage(messages.push.disabled);
    } catch {
      setMessage(messages.push.disableError);
    } finally {
      setBusy(false);
    }
  }

  if (!supported) {
    return (
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        {requiresSecureContext
          ? messages.push.browserSecureOnly
          : messages.push.browserUnsupported}
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <div style={{ fontSize: 13, color: '#6b7280' }}>
        {messages.push.statusLabel}: {enabled ? messages.push.statusEnabled : messages.push.statusDisabled}
        {configured ? '' : messages.push.statusServerNotConfigured}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {!enabled ? (
          <button
            type="button"
            disabled={busy || !configured}
            onClick={enablePush}
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #2563eb', background: '#fff', color: '#2563eb', fontWeight: 800 }}
          >
            {messages.push.enableButton}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={disablePush}
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ef4444', background: '#fff', color: '#b91c1c', fontWeight: 800 }}
          >
            {messages.push.disableButton}
          </button>
        )}
      </div>

      <div style={{ fontWeight: 800 }}>{messages.push.settingsTitle}</div>

      {!canEditTable ? (
        <div style={{ fontSize: 13, color: '#6b7280' }}>{messages.push.noEvents}</div>
      ) : (
        <div style={{ overflowX: 'auto', border: '1px solid #e5e7eb', borderRadius: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ textAlign: 'left', padding: '10px 8px', borderBottom: '1px solid #e5e7eb' }}>{messages.push.eventColumn}</th>
                <th style={{ textAlign: 'center', padding: '10px 8px', borderBottom: '1px solid #e5e7eb' }}>{messages.push.pushColumn}</th>
                <th style={{ textAlign: 'center', padding: '10px 8px', borderBottom: '1px solid #e5e7eb' }}>{messages.push.emailColumn}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const rowBusy = savingEvent === row.eventType;
                return (
                  <tr key={row.eventType}>
                    <td style={{ padding: '10px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      {resolveEventLabel(row.eventType, row.label, messages.push.events)}
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <input
                        type="checkbox"
                        checked={row.pushEnabled}
                        disabled={rowBusy}
                        onChange={(e) => updateRow(row, { pushEnabled: e.target.checked })}
                      />
                    </td>
                    <td style={{ textAlign: 'center', padding: '10px 8px', borderBottom: '1px solid #f1f5f9' }}>
                      <input
                        type="checkbox"
                        checked={row.emailEnabled}
                        disabled={rowBusy}
                        onChange={(e) => updateRow(row, { emailEnabled: e.target.checked })}
                      />
                    </td>
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
