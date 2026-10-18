'use client';

import { useEffect, useState } from 'react';
import type { Locale } from '@/i18n/locale';
import { repCounterMessages } from '@/i18n/messages/features/rep-counter';
import { formatDuration } from '@/lib/exercise-metrics';
import { isNativeApp } from '@/lib/platform';
import {
  countReps,
  isRepCountExercise,
  openRepCounterSettings,
  repCounterAvailability,
  visibleRepCounterModes,
  type RepCounterAvailability,
  type RepCounterMode,
} from '@/lib/rep-counter';

type Props = {
  exerciseType: string;
  locale: Locale;
  disabled?: boolean;
  /** «Готово» on the native screen with reps counted: fill the form. */
  onCounted(reps: number, durationSeconds: number): void;
};

type Notice = { kind: 'permission' } | { kind: 'text'; text: string };

/**
 * «Считать камерой» / «Считать касанием» under the reps field (spec stories 35–41): only in the app,
 * only for push-ups, squats and pull-ups; «touch» only with a proximity sensor. A refused camera
 * leaves manual entry as it was and offers the system settings.
 */
export default function RepCounterButtons({ exerciseType, locale, disabled, onCounted }: Props) {
  const text = repCounterMessages[locale];
  const native = isNativeApp();
  const [availability, setAvailability] = useState<Partial<Record<RepCounterMode, RepCounterAvailability>>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void Promise.all([repCounterAvailability('camera'), repCounterAvailability('proximity')]).then(([camera, proximity]) => {
      if (!cancelled) setAvailability({ camera, proximity });
    });
    return () => {
      cancelled = true;
    };
  }, [native]);

  useEffect(() => {
    setNotice(null);
  }, [exerciseType]);

  const modes = visibleRepCounterModes(exerciseType, { native, availability });
  if (modes.length === 0 || !isRepCountExercise(exerciseType)) return null;

  const start = async (mode: RepCounterMode) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      const outcome = await countReps(mode, exerciseType, locale);
      switch (outcome.kind) {
        case 'counted':
          onCounted(outcome.reps, outcome.durationSeconds);
          setNotice({
            kind: 'text',
            text: text.counted.replace('{reps}', String(outcome.reps)).replace('{duration}', formatDuration(outcome.durationSeconds)),
          });
          break;
        case 'empty':
          setNotice({ kind: 'text', text: text.empty });
          break;
        case 'permission_denied':
          setNotice({ kind: 'permission' });
          break;
        case 'unavailable':
          setNotice({
            kind: 'text',
            text: outcome.reason === 'no_camera' ? text.noCamera : outcome.reason === 'no_sensor' ? text.noSensor : text.unsupported,
          });
          break;
        case 'error':
          setNotice({ kind: 'text', text: text.failed.replace('{message}', outcome.message) });
          break;
        case 'cancelled':
          break;
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={wrap}>
      <div style={{ ...grid, gridTemplateColumns: modes.length > 1 ? '1fr 1fr' : '1fr' }}>
        {modes.map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => void start(mode)}
            disabled={disabled || busy}
            aria-busy={busy}
            style={disabled || busy ? { ...button, opacity: 0.6 } : button}
          >
            {mode === 'camera' ? text.cameraButton : text.proximityButton}
          </button>
        ))}
      </div>
      {notice?.kind === 'permission' ? (
        <div style={noticeBox} role="alert">
          <span>{text.permissionDenied}</span>
          <button type="button" onClick={() => void openRepCounterSettings()} style={settingsButton}>
            {text.openSettings}
          </button>
        </div>
      ) : null}
      {notice?.kind === 'text' ? (
        <div style={noticeBox} role="status">
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}

const wrap: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
  display: 'grid',
  gap: 8,
};

const grid: React.CSSProperties = {
  display: 'grid',
  gap: 12,
};

const button: React.CSSProperties = {
  minHeight: 52,
  padding: '10px 12px',
  borderRadius: 18,
  border: '1px solid rgba(15, 23, 42, 0.12)',
  background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 17,
  cursor: 'pointer',
};

const noticeBox: React.CSSProperties = {
  display: 'grid',
  gap: 8,
  padding: '10px 12px',
  borderRadius: 14,
  background: 'rgba(15, 23, 42, 0.06)',
  color: '#0f172a',
  fontSize: 14,
  lineHeight: 1.4,
};

const settingsButton: React.CSSProperties = {
  justifySelf: 'start',
  padding: '8px 14px',
  borderRadius: 12,
  border: 'none',
  background: '#0f172a',
  color: '#fff',
  fontWeight: 700,
  fontSize: 14,
  cursor: 'pointer',
};
