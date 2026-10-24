'use client';

import Link from 'next/link';
import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { useAuth } from '@/auth/provider';
import { InfoButton } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { nativeHealthMessages } from '@/i18n/messages/features/native-health';
import {
  HEALTH_RECONCILE_PROGRESS_EVENT,
  healthAvailability,
  healthPlatform,
  isHealthEnergyEnabled,
  isHealthWriteEnabled,
  openHealthSettings,
  reconcileHealth,
  requestHealthPermissions,
  setHealthEnergyEnabled,
  setHealthWriteEnabled,
  syncBodyMetrics,
  type HealthReconcileProgress,
} from '@/lib/health/health';

type Notice = { text: string; tone: 'info' | 'error'; action?: 'install' | 'settings' };

const noSubscribe = () => () => undefined;

/**
 * «Здоровье» in the app's profile: the switch «Save workouts to Apple Health / Health Connect».
 * Switching on asks for Health permissions, takes weight/height from Health into the profile and
 * copies the whole history with a progress line; on the site the block is not shown at all.
 * «Передавать калории в Health» (по умолчанию включён) — против задвоения с часами: переключение
 * переписывает записи истории с энергией или без. Без веса в профиле — приглашение его указать.
 * `showTitle={false}` — внутри раздела «Профиль → Здоровье», где заголовок уже в шапке уровня.
 */
export default function HealthSettings({ showTitle = true }: { showTitle?: boolean } = {}) {
  const { locale } = useI18n();
  const { user, refreshUser } = useAuth();
  const text = nativeHealthMessages[locale === 'en' ? 'en' : 'ru'];
  const platform = useSyncExternalStore(noSubscribe, healthPlatform, () => null);
  const storedEnabled = useSyncExternalStore(noSubscribe, isHealthWriteEnabled, () => false);
  const storedEnergy = useSyncExternalStore(noSubscribe, isHealthEnergyEnabled, () => true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [energyChoice, setEnergyChoice] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<HealthReconcileProgress | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const on = enabled ?? storedEnabled;
  const energyOn = energyChoice ?? storedEnergy;

  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<HealthReconcileProgress>).detail;
      if (detail) setProgress(detail);
    };
    window.addEventListener(HEALTH_RECONCILE_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(HEALTH_RECONCILE_PROGRESS_EVENT, onProgress);
  }, []);

  if (!platform) return null;

  const switchOn = async () => {
    const availability = await healthAvailability();
    if (!availability.available) {
      if (availability.reason === 'not_installed') setNotice({ text: text.notInstalled, tone: 'error', action: 'install' });
      else if (availability.reason === 'update_required') setNotice({ text: text.updateRequired, tone: 'error', action: 'install' });
      else setNotice({ text: text.notSupported, tone: 'error' });
      return;
    }
    const granted = await requestHealthPermissions(user?.id);
    if (!granted) {
      setNotice({ text: text.denied, tone: 'error', action: 'settings' });
      return;
    }
    setHealthWriteEnabled(true);
    setEnabled(true);
    // Вес и рост из Health — до переноса истории: калории записей считаются по ним.
    if (user?.id && (await syncBodyMetrics(user.id, { force: true }).catch(() => false))) await refreshUser();
    const result = await reconcileHealth({ full: true, userId: user?.id });
    const changed = result ? result.saved + result.rewritten + result.deleted : 0;
    if (result && result.failed > 0) setNotice({ text: text.failed, tone: 'error', action: 'settings' });
    else setNotice({ text: changed > 0 ? text.finished : text.upToDate, tone: 'info' });
  };

  const toggle = async (next: boolean) => {
    if (busy) return;
    setNotice(null);
    setProgress(null);
    if (!next) {
      setHealthWriteEnabled(false);
      setEnabled(false);
      return;
    }
    setBusy(true);
    try {
      await switchOn();
    } catch (error) {
      console.error('Health switch-on failed', error);
      setNotice({ text: text.failed, tone: 'error', action: 'settings' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const toggleEnergy = async (next: boolean) => {
    if (busy) return;
    setNotice(null);
    setProgress(null);
    setHealthEnergyEnabled(next, user?.id);
    setEnergyChoice(next);
    if (!on) return;
    // Записи истории переписываются с калориями или без них.
    setBusy(true);
    try {
      const result = await reconcileHealth({ full: true, userId: user?.id });
      if (result && result.failed > 0) setNotice({ text: text.failed, tone: 'error', action: 'settings' });
    } catch (error) {
      console.error('Health rewrite after the calories switch failed', error);
      setNotice({ text: text.failed, tone: 'error', action: 'settings' });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const label = platform === 'apple_health' ? text.toggleAppleHealth : text.toggleHealthConnect;
  const apple = platform === 'apple_health';
  const summary = platform === 'apple_health' ? text.summaryAppleHealth : text.summaryHealthConnect;

  // Пояснения — под «i» (R11): что уходит в Health, калории, данные тела, кольца, импорт.
  const info = (
    <InfoButton title={text.infoTitle}>
      <p>{summary}</p>
      <p>{text.infoCalories}</p>
      <p>{apple ? text.infoBodyAppleHealth : text.infoBodyHealthConnect}</p>
      <p>{apple ? text.infoRingsAppleHealth : text.infoRingsHealthConnect}</p>
      <p>{apple ? text.importLinkHintAppleHealth : text.importLinkHintHealthConnect}</p>
    </InfoButton>
  );

  return (
    <section style={panelCard} data-testid="health-settings">
      {showTitle ? (
        <div style={titleRow}>
          <div style={sectionTitle}>{text.sectionTitle}</div>
          {info}
        </div>
      ) : null}
      <div style={{ ...titleRow, justifyContent: 'flex-start' }}>
        <label style={switchRow}>
          <input
            type="checkbox"
            role="switch"
            aria-checked={on}
            checked={on}
            disabled={busy}
            onChange={(e) => void toggle(e.target.checked)}
            style={{ width: 22, height: 22, accentColor: '#ea580c' }}
          />
          <span style={{ fontWeight: 800, color: '#0f172a' }}>{label}</span>
        </label>
        {showTitle ? null : info}
      </div>
      {on ? (
        <div style={{ display: 'grid', gap: 2 }}>
          <label style={switchRow}>
            <input
              type="checkbox"
              role="switch"
              aria-checked={energyOn}
              checked={energyOn}
              disabled={busy}
              onChange={(e) => void toggleEnergy(e.target.checked)}
              style={{ width: 22, height: 22, accentColor: '#ea580c' }}
              data-testid="health-energy-switch"
            />
            <span style={{ fontWeight: 800, color: '#0f172a' }}>{text.energyToggle}</span>
          </label>
          <div style={fieldHint}>{text.energyHint}</div>
        </div>
      ) : null}
      {user?.weightKg === null ? (
        <div style={promptBox} data-testid="health-weight-prompt">
          {text.weightPrompt}{' '}
          <Link href="/profile?section=personal" style={promptLink}>{text.weightPromptLink}</Link>
        </div>
      ) : null}
      {busy && progress && progress.total > 0 ? (
        <div style={fieldHint} role="status" aria-live="polite">
          {text.progress.replace('{done}', String(progress.done)).replace('{total}', String(progress.total))}
        </div>
      ) : null}
      {notice ? (
        <div style={notice.tone === 'error' ? errorBox : infoBox} role={notice.tone === 'error' ? 'alert' : 'status'}>
          {notice.text}
        </div>
      ) : null}
      <div>
        <Link href="/health-import" style={importLinkStyle} data-testid="health-import-link">{text.importLink}</Link>
      </div>
      {notice?.action ? (
        <div>
          <button type="button" style={buttonSecondary} onClick={() => void openHealthSettings()}>
            {notice.action === 'install' ? text.installHealthConnect : text.openSettings}
          </button>
        </div>
      ) : null}
    </section>
  );
}

const panelCard: CSSProperties = {
  display: 'grid',
  gap: 16,
  padding: 'clamp(18px, 3vw, 24px)',
  borderRadius: 28,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)',
};

const sectionTitle: CSSProperties = { fontSize: 18, fontWeight: 900, color: '#0f172a' };

const titleRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 };

const promptBox: CSSProperties = {
  padding: '12px 14px',
  borderRadius: 16,
  background: 'rgba(255, 237, 213, 0.7)',
  border: '1px solid rgba(251, 146, 60, 0.3)',
  color: '#9a3412',
  fontWeight: 700,
  lineHeight: 1.5,
};

const promptLink: CSSProperties = { color: '#ea580c', fontWeight: 900 };

const importLinkStyle: CSSProperties = { fontWeight: 900, color: '#ea580c', textDecoration: 'none', minHeight: 44, display: 'inline-flex', alignItems: 'center' };

const fieldHint: CSSProperties = { fontSize: 13, color: '#64748b', lineHeight: 1.5 };

const switchRow: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 44, cursor: 'pointer' };

const buttonSecondary: CSSProperties = {
  minHeight: 48,
  padding: '10px 16px',
  borderRadius: 14,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.82)',
  color: '#0f172a',
  fontWeight: 900,
  cursor: 'pointer',
};

const errorBox: CSSProperties = {
  margin: 0,
  padding: '14px 16px',
  borderRadius: 18,
  background: 'rgba(254, 226, 226, 0.92)',
  border: '1px solid rgba(248, 113, 113, 0.34)',
  color: '#b91c1c',
  fontWeight: 700,
};

const infoBox: CSSProperties = {
  ...errorBox,
  background: 'rgba(220, 252, 231, 0.92)',
  border: '1px solid rgba(74, 222, 128, 0.34)',
  color: '#15803d',
};
