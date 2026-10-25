'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAuth } from '@/auth/provider';
import { BackButton, InfoButton } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { nativeHealthMessages } from '@/i18n/messages/features/native-health';
import { calculateExercisePoints } from '@/lib/exercise-points';
import { formatDistance, formatDuration } from '@/lib/exercise-metrics';
import { exerciseLabel } from '@/lib/exercises';
import {
  HealthNotAuthorizedError,
  healthAvailability,
  healthPlatform,
  importHealthSessions,
  listImportableCardio,
  openHealthSettings,
} from '@/lib/health/health';
import { healthClientRequestId, type ImportCandidate, type ImportReason } from '@/lib/health/mapping';

type Phase = 'loading' | 'ready' | 'denied' | 'unavailable' | 'failed';
type Summary = { created: number; duplicate: number; rejected: number; limited: boolean };

const REASON_KEY = {
  unsupported: 'reasonUnsupported',
  no_distance: 'reasonNoDistance',
  too_short: 'reasonTooShort',
  too_long: 'reasonTooLong',
  no_duration: 'reasonNoDuration',
} as const satisfies Record<ImportReason, string>;

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** «Импорт из Health»: сессии бега, велосипеда и гребли за 30 дней, которых нет в трекере. */
export default function HealthImportScreen() {
  const { locale } = useI18n();
  const { user } = useAuth();
  const lang = locale === 'en' ? 'en' : 'ru';
  const text = nativeHealthMessages[lang];
  const platform = healthPlatform();
  const timeZone = user?.timeZone || browserZone();

  const [phase, setPhase] = useState<Phase>('loading');
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [sendFailed, setSendFailed] = useState(false);

  const load = useCallback(async () => {
    setPhase('loading');
    try {
      const availability = await healthAvailability();
      if (!availability.available) {
        setPhase('unavailable');
        return;
      }
      const list = await listImportableCardio(timeZone);
      setCandidates(list);
      setSelected(new Set(list.filter((c) => c.workout).map((c) => c.workout!.clientRequestId)));
      setPhase('ready');
    } catch (error) {
      if (error instanceof HealthNotAuthorizedError) setPhase('denied');
      else {
        console.error('Health import list failed', error);
        setPhase('failed');
      }
    }
  }, [timeZone]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from the Health app (a workout was just added there): read the list again.
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;
    void import('@capacitor/app')
      .then(({ App }) =>
        App.addListener('resume', () => {
          if (!busyRef.current) void load();
        }),
      )
      .then((h) => {
        if (cancelled) void h.remove();
        else handle = h;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [load]);

  const importable = useMemo(() => candidates.filter((c) => c.workout), [candidates]);
  const chosen = useMemo(() => importable.filter((c) => selected.has(c.workout!.clientRequestId)), [importable, selected]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = importable.length > 0 && chosen.length === importable.length;
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(importable.map((c) => c.workout!.clientRequestId)));

  const runImport = async () => {
    if (busy || chosen.length === 0) return;
    setBusy(true);
    busyRef.current = true;
    setSendFailed(false);
    setSummary(null);
    try {
      const outcomes = await importHealthSessions(chosen);
      const done = new Set(outcomes.filter((o) => o.status !== 'rejected').map((o) => o.clientRequestId));
      const rejected = outcomes.filter((o) => o.status === 'rejected');
      setSummary({
        created: outcomes.filter((o) => o.status === 'created').length,
        duplicate: outcomes.filter((o) => o.status === 'duplicate').length,
        rejected: rejected.length,
        limited: rejected.some((o) => o.error === 'RATE_LIMITED'),
      });
      setCandidates((prev) => prev.filter((c) => !c.workout || !done.has(c.workout.clientRequestId)));
      setSelected((prev) => new Set([...prev].filter((id) => !done.has(id))));
    } catch (error) {
      console.error('Health import failed', error);
      setSendFailed(true);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  };

  if (!platform) {
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

  const unavailableText = text.notSupported;
  const summaryLine = summary
    ? [
        text.importDone.replace('{created}', String(summary.created)),
        summary.duplicate ? text.importDoneDuplicates.replace('{duplicate}', String(summary.duplicate)) : '',
        summary.rejected ? text.importDoneRejected.replace('{rejected}', String(summary.rejected)) : '',
      ]
        .filter(Boolean)
        .join(', ')
    : '';

  return (
    <div className="app-page" style={wrap} data-testid="health-import">
      <section style={card}>
        {/* Импорт открывают из раздела «Здоровье» профиля — туда и возвращаемся без истории (R14.1). */}
        <BackButton fallbackHref="/profile?section=health" />
        <h1 style={title}>
          {text.importTitle}{' '}
          <InfoButton title={text.importTitle}>{text.importIntro}</InfoButton>
        </h1>
      </section>

      {summary ? (
        <div style={summary.rejected && !summary.created ? errorBox : infoBox} role="status" data-testid="health-import-summary">
          {summaryLine}
          {summary.limited ? <div>{text.importLimit}</div> : null}
        </div>
      ) : null}
      {sendFailed ? <div style={errorBox} role="alert">{text.importSendFailed}</div> : null}

      {phase === 'loading' ? <div style={hint} role="status">{text.importLoading}</div> : null}

      {phase === 'denied' ? (
        <section style={card}>
          <div style={errorBox} role="alert">{text.importDenied}</div>
          <div style={actions}>
            <button type="button" style={buttonSecondary} onClick={() => void openHealthSettings()}>{text.importOpenSettings}</button>
            <button type="button" style={buttonSecondary} onClick={() => void load()}>{text.importRetry}</button>
          </div>
        </section>
      ) : null}

      {phase === 'unavailable' ? (
        <section style={card}>
          <div style={errorBox} role="alert">{unavailableText}</div>
        </section>
      ) : null}

      {phase === 'failed' ? (
        <section style={card}>
          <div style={errorBox} role="alert">{text.importFailed}</div>
          <div style={actions}>
            <button type="button" style={buttonSecondary} onClick={() => void load()}>{text.importRetry}</button>
          </div>
        </section>
      ) : null}

      {phase === 'ready' && candidates.length === 0 ? (
        <div style={hint} data-testid="health-import-empty">
          {text.importEmpty}
          {/* iPhone never says that reading was denied: an empty list may mean no permission. */}
          {platform === 'apple_health' ? (
            <>
              <p style={{ margin: '8px 0 0' }} data-testid="health-import-permissions-hint">{text.importEmptyPermissionsHint}</p>
              <div style={{ ...actions, marginTop: 10 }}>
                <button type="button" style={buttonSecondary} onClick={() => void openHealthSettings()}>{text.importOpenSettings}</button>
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      {phase === 'ready' && candidates.length > 0 ? (
        <section style={card}>
          {importable.length > 0 ? (
            <button type="button" style={linkButton} onClick={toggleAll}>{allSelected ? text.importSelectNone : text.importSelectAll}</button>
          ) : null}
          <ul style={list}>
            {candidates.map((c) => {
              const w = c.workout;
              const id = w ? w.clientRequestId : healthClientRequestId(c.session);
              const checked = w ? selected.has(id) : false;
              const when = new Date(c.session.end).toLocaleString(lang === 'en' ? 'en-GB' : 'ru-RU', { dateStyle: 'medium', timeStyle: 'short', timeZone });
              return (
                <li key={id} style={w ? row : { ...row, opacity: 0.55 }} data-testid="health-import-row">
                  <label style={rowLabel}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!w || busy}
                      onChange={() => toggle(id)}
                      aria-label={`${exerciseLabel(c.session.activity, lang)} ${when}`}
                      style={{ width: 22, height: 22, accentColor: '#ea580c', flex: 'none' }}
                    />
                    <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                      <span style={rowTitle}>
                        {exerciseLabel(c.session.activity, lang)}
                        {c.session.distanceMeters != null ? ` · ${formatDistance(c.session.distanceMeters, lang)}` : ''}
                        {w ? ` · ${formatDuration(w.durationSeconds)}` : ''}
                      </span>
                      <span style={hint}>
                        {when}
                        {c.session.sourceName ? ` · ${text.importSource.replace('{source}', c.session.sourceName)}` : ''}
                      </span>
                      {w ? (
                        <span style={hint}>{text.importPoints.replace('{points}', String(calculateExercisePoints(w.reps, w.exerciseType)))}</span>
                      ) : (
                        <span style={{ ...hint, color: '#b91c1c' }}>{c.reason ? text[REASON_KEY[c.reason]] : ''}</span>
                      )}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <button type="button" style={buttonPrimary} disabled={busy || chosen.length === 0} onClick={() => void runImport()}>
            {busy ? text.importing : text.importButton.replace('{count}', String(chosen.length))}
          </button>
        </section>
      ) : null}
    </div>
  );
}

const wrap: CSSProperties = { display: 'grid', gap: 16, maxWidth: 720, margin: '0 auto' };
const card: CSSProperties = { display: 'grid', gap: 14, padding: 'clamp(18px, 3vw, 24px)', borderRadius: 28, border: '1px solid rgba(255, 255, 255, 0.86)', background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%)', boxShadow: '0 20px 52px rgba(15, 23, 42, 0.08)' };
const title: CSSProperties = { margin: 0, fontSize: 24, fontWeight: 900, color: '#0f172a' };
const hint: CSSProperties = { margin: 0, fontSize: 13, color: '#64748b', lineHeight: 1.5 };
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 10 };
const row: CSSProperties = { borderRadius: 18, border: '1px solid rgba(148, 163, 184, 0.28)', background: 'rgba(255, 255, 255, 0.82)' };
const rowLabel: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, minHeight: 56, padding: '10px 14px' };
const rowTitle: CSSProperties = { fontWeight: 800, color: '#0f172a' };
const actions: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 10 };
const linkButton: CSSProperties = { justifySelf: 'start', minHeight: 44, padding: '0 4px', border: 'none', background: 'none', color: '#ea580c', fontWeight: 800, cursor: 'pointer' };
const buttonPrimary: CSSProperties = { minHeight: 52, padding: '10px 18px', borderRadius: 16, border: 'none', background: 'linear-gradient(135deg, #f97316, #ea580c)', color: '#fff', fontWeight: 900, cursor: 'pointer' };
const buttonSecondary: CSSProperties = { minHeight: 48, padding: '10px 16px', borderRadius: 14, border: '1px solid rgba(148, 163, 184, 0.28)', background: 'rgba(255, 255, 255, 0.82)', color: '#0f172a', fontWeight: 900, cursor: 'pointer' };
const errorBox: CSSProperties = { margin: 0, padding: '14px 16px', borderRadius: 18, background: 'rgba(254, 226, 226, 0.92)', border: '1px solid rgba(248, 113, 113, 0.34)', color: '#b91c1c', fontWeight: 700 };
const infoBox: CSSProperties = { ...errorBox, background: 'rgba(220, 252, 231, 0.92)', border: '1px solid rgba(74, 222, 128, 0.34)', color: '#15803d' };
