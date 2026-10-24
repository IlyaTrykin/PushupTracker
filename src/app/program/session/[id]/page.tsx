'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { useRouteParam } from '@/lib/use-route-param';
import { programSessionMessages } from '@/i18n/messages/features/program-session';
import { programsMessages } from '@/i18n/messages/features/programs';
import { circuitsMessages } from '@/i18n/messages/features/circuits';
import { BackButton, InfoButton } from '@/components/ui';
import { WorkoutPlayer } from '@/components/workout-player';
import { getCircuitTemplate } from '@/lib/circuits';
import { isDistanceExercise } from '@/lib/exercises';
import { syncWorkoutToHealth } from '@/lib/health/health';
import { programSetHealthSource } from '@/lib/health/mapping';
import { programLabel, programSetWorkoutReps, type ProgramSessionKind } from '@/lib/program-plan';
import { programSessionSteps, programSetBody, type PlayerStep, type StepResult } from '@/lib/workout-player';

type TrainingSet = {
  id: string;
  setNumber: number;
  targetReps: number;
  actualReps: number | null;
  actualLeft?: number | null;
  actualRight?: number | null;
  actualSeconds?: number | null;
  restSeconds: number;
  isKeySet: boolean;
  exerciseType?: string | null;
  loadKg?: number | null;
  round?: number | null;
  station?: number | null;
};

type TrainingSession = {
  id: string;
  weekNumber: number;
  sessionNumber: number;
  scheduledAt: string;
  isFinalTest?: boolean;
  sessionKind?: ProgramSessionKind | null;
  dayLabel?: string | null;
  circuitTemplateId?: string | null;
  startedAt: string | null;
  completed: boolean;
  completedAt: string | null;
  sets: TrainingSet[];
};

type ProgramDetail = {
  id: string;
  exerciseType: string;
  programType?: string | null;
  loadKg?: number | null;
  circuitPlanId?: string | null;
  sessions: TrainingSession[];
};

type JsonObject = Record<string, unknown>;

type ApiError = Error & {
  code?: string;
  status?: number;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let data: JsonObject | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as JsonObject;
    } catch {}
  }
  if (!res.ok) {
    const err = new Error(typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`) as ApiError;
    err.code = typeof data?.code === 'string' ? data.code : undefined;
    err.status = res.status;
    throw err;
  }
  return data;
}

function numOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Занятие программы: пошаговый проигрыватель (обычная, гиревая, «на сторону», дистанция, круговая). */
export default function ProgramSessionPage() {
  const { locale, messages } = useI18n();
  const { user } = useAuth();
  const router = useRouter();
  const sessionId = useRouteParam('id') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  // Synchronous guard: a second tap arrives before `saving` re-renders the disabled button.
  const busyRef = useRef(false);
  const finishCopy = programSessionMessages[locale].finish;
  const circuitText = circuitsMessages[locale];

  // A network failure has no server message ("Failed to fetch") — show our own text then.
  const finishErrorText = useCallback(
    (e: unknown) => ((e as ApiError).status ? getErrorMessage(e, finishCopy.failed) : finishCopy.failed),
    [finishCopy.failed],
  );

  const completeSession = useCallback(
    async (id: string) => {
      try {
        await fetchJson(`/api/program/session/${id}/complete`, { method: 'POST' });
        setDone(true);
        setInfo(messages.programSession.complete.info);
        return true;
      } catch (e: unknown) {
        setError(finishErrorText(e));
        return false;
      }
    },
    [finishErrorText, messages.programSession.complete.info],
  );

  const finishSession = async () => {
    if (!session || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      await completeSession(session.id);
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  const load = async (forceStartEarly = false) => {
    if (!sessionId) return;
    setLoading(true);
    setError(null);
    try {
      const init: RequestInit = forceStartEarly
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ forceStartEarly: true }) }
        : { method: 'POST' };
      const res = await fetchJson(`/api/program/session/${sessionId}/start`, init);
      const response = isJsonObject(res) ? res : null;
      const p = response && isJsonObject(response.program) ? (response.program as ProgramDetail) : null;
      setProgram(p);
      const s = p?.sessions.find((x) => x.id === sessionId) || null;
      setSession(s);
      if (!s) {
        setError(messages.programSession.errors.sessionNotFound);
      } else if (s.completed) {
        setDone(true);
      } else if (s.sets.length > 0 && s.sets.every((x) => x.actualReps != null)) {
        // Every set is recorded but the earlier /complete did not go through — finish now.
        await completeSession(s.id);
      }
    } catch (e: unknown) {
      const apiError = e as ApiError;
      if (apiError.code === 'REST_PERIOD_NOT_FINISHED' && !forceStartEarly) {
        const ok = window.confirm(
          `${getErrorMessage(e, messages.programSession.confirmStartEarly.title)}\n\n${messages.programSession.confirmStartEarly.body}`,
        );
        if (ok) {
          await load(true);
          return;
        }
      }
      setError(getErrorMessage(e, messages.programSession.errors.openFailed));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const steps = useMemo<PlayerStep[]>(
    () =>
      program && session
        ? programSessionSteps({ exerciseType: program.exerciseType, programType: program.programType, loadKg: program.loadKg, sets: session.sets })
        : [],
    [program, session],
  );
  const doneIds = useMemo(
    () => new Set((session?.sets ?? []).filter((s) => s.actualReps != null).map((s) => `set:${s.id}`)),
    [session],
  );
  const allSetsRecorded = Boolean(session && session.sets.length > 0 && session.sets.every((x) => x.actualReps != null));
  const isCircuit = program?.programType === 'circuit' || program?.exerciseType === 'circuit';

  /** «Готово» подхода: запись на сервер, тренировка подхода сразу в Health (вес, стороны, время). */
  const onStepDone = useCallback(
    async (step: PlayerStep, result: StepResult) => {
      if (step.kind !== 'exercise' || !session || !step.setId) return;
      const body = programSetBody(step, result);
      if (!body) {
        throw new Error(isDistanceExercise(step.exerciseType) ? circuitText.player.invalidDistance : circuitText.player.invalid);
      }
      setError(null);
      setInfo(null);
      let saved: JsonObject | null;
      try {
        saved = await fetchJson(`/api/program/session/${session.id}/set/${step.setId}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch (e) {
        throw new Error(getErrorMessage(e, messages.programSession.errors.saveSetFailed));
      }
      const savedSet = saved && isJsonObject(saved.set) ? (saved.set as JsonObject) : null;
      const record = {
        id: step.setId,
        setNumber: session.sets.find((s) => s.id === step.setId)?.setNumber ?? step.setNumber ?? 1,
        actualReps: numOrNull(savedSet?.actualReps),
        actualLeft: numOrNull(savedSet?.actualLeft),
        actualRight: numOrNull(savedSet?.actualRight),
        actualSeconds: numOrNull(savedSet?.actualSeconds),
        loadKg: numOrNull(savedSet?.loadKg),
        completedAt: typeof savedSet?.completedAt === 'string' ? savedSet.completedAt : null,
      };
      // Apple Health / Health Connect: the set's workout is written at once (app only, when on),
      // as the server stored it — the sum of sides and the run time, so the next reconcile finds it in place.
      const source = step.exerciseType ? programSetHealthSource(record, step.exerciseType, user?.timeZone) : null;
      if (source) {
        void syncWorkoutToHealth(
          { ...source, reps: programSetWorkoutReps(record), durationSeconds: record.actualSeconds ?? source.durationSeconds },
          user?.id,
        );
      }
      setSession((prev) =>
        prev
          ? {
              ...prev,
              sets: prev.sets.map((s) =>
                s.id === step.setId
                  ? { ...s, actualReps: record.actualReps ?? 0, actualLeft: record.actualLeft, actualRight: record.actualRight, actualSeconds: record.actualSeconds }
                  : s,
              ),
            }
          : prev,
      );
      // Последний подход — занятие завершается сразу (если не вышло — карточка «Завершить» ниже).
      if (session.sets.every((s) => s.id === step.setId || s.actualReps != null)) {
        setSaving(true);
        try {
          await completeSession(session.id);
        } finally {
          setSaving(false);
        }
      }
    },
    [circuitText.player.invalid, circuitText.player.invalidDistance, completeSession, messages.programSession.errors.saveSetFailed, session, user?.id, user?.timeZone],
  );

  // Завершение отправляет сам последний подход (`onStepDone`), проигрыватель к этому моменту уже скрыт.
  const onComplete = useCallback(() => {}, []);

  const headerTitle = useMemo(() => {
    if (!program || !session) return '';
    if (isCircuit) {
      const template = getCircuitTemplate(session.circuitTemplateId);
      const title = template ? template.title[locale] : programLabel(program, locale);
      return session.dayLabel ? circuitText.program.sessionTitle(session.dayLabel, title) : title;
    }
    return programLabel(program, locale);
  }, [circuitText.program, isCircuit, locale, program, session]);

  const headerMeta = useMemo(() => {
    if (!session) return '';
    const parts = [
      `${messages.programSession.header.week} ${session.weekNumber}`,
      `${messages.programSession.header.workout} #${session.sessionNumber}`,
    ];
    if (session.isFinalTest) parts.push(messages.programSession.header.finalTest);
    if (session.sessionKind === 'test') parts.push(circuitText.program.testCircuit);
    else if (session.sessionKind) parts.push(programsMessages[locale].sessionKind[session.sessionKind]);
    return parts.join(' · ');
  }, [circuitText.program.testCircuit, locale, messages.programSession.header, session]);

  return (
    <div className="app-page ui-slide-in" style={{ maxWidth: 760 }}>
      <div style={headRow}>
        <BackButton fallbackHref="/program" />
      </div>
      {loading ? <p>{messages.common.loading}</p> : null}

      {program && session ? (
        <div style={{ marginBottom: 12 }}>
          <h1 style={{ margin: '4px 0', fontSize: 22 }} data-testid="session-title">
            {headerTitle}
          </h1>
          <div style={{ color: '#475569', fontSize: 14 }}>{headerMeta}</div>
        </div>
      ) : null}

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {info ? <p style={{ color: '#16a34a' }}>{info}</p> : null}

      {!loading && !done && session && allSetsRecorded ? (
        <section style={card}>
          <div style={{ display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center' }}>
            <div style={{ fontWeight: 800 }}>{finishCopy.hint}</div>
            <button type="button" style={{ ...btnPrimary, width: 'min(100%, 520px)' }} onClick={() => void finishSession()} disabled={saving}>
              {saving ? finishCopy.finishing : finishCopy.button}
            </button>
          </div>
        </section>
      ) : null}

      {!loading && !done && session && !allSetsRecorded && steps.length ? (
        <WorkoutPlayer
          steps={steps}
          done={doneIds}
          resumeKey={`program-session-warmup:v1:${session.id}`}
          onStepDone={onStepDone}
          onComplete={onComplete}
          info={
            isCircuit ? (
              <InfoButton title={circuitText.screen.safetyTitle}>
                <p>{circuitText.screen.safety}</p>
                <p>{circuitText.player.warmup.info}</p>
              </InfoButton>
            ) : null
          }
        />
      ) : null}

      {done ? (
        <section style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>{messages.programSession.complete.title}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/program" style={btnLink}>
              {messages.programSession.complete.toProgram}
            </Link>
            <button type="button" style={btnSecondary} onClick={() => router.push('/dashboard')}>
              {messages.programSession.complete.toDashboard}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

const headRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginBottom: 4,
};

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
  overflow: 'hidden',
};

const btnPrimary: React.CSSProperties = {
  border: 'none',
  borderRadius: 14,
  padding: '14px 16px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 900,
  fontSize: 20,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#fff',
  color: '#111827',
  fontWeight: 800,
  cursor: 'pointer',
};

const btnLink: React.CSSProperties = {
  display: 'inline-block',
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#fff',
  color: '#111827',
  fontWeight: 800,
  textDecoration: 'none',
};
