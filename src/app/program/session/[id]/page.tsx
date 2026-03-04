'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type TrainingSet = {
  id: string;
  setNumber: number;
  targetReps: number;
  actualReps: number | null;
  restSeconds: number;
  isKeySet: boolean;
};

type TrainingSession = {
  id: string;
  weekNumber: number;
  sessionNumber: number;
  scheduledAt: string;
  isFinalTest?: boolean;
  startedAt: string | null;
  completed: boolean;
  completedAt: string | null;
  sets: TrainingSet[];
};

type ProgramDetail = {
  id: string;
  exerciseType: string;
  sessions: TrainingSession[];
};

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {}
  }
  if (!res.ok) {
    const err: any = new Error(data?.error || `Ошибка (код ${res.status})`);
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

function exerciseLabel(exerciseType: string) {
  if (exerciseType === 'pushups') return 'Отжимания';
  if (exerciseType === 'pullups') return 'Подтягивания';
  if (exerciseType === 'crunches') return 'Скручивания';
  if (exerciseType === 'squats') return 'Приседания';
  return exerciseType;
}

function sanitizePositiveInt(value: string): number {
  const onlyDigits = value.replace(/[^\d]/g, '');
  const n = Number(onlyDigits || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(5000, Math.round(n));
}

export default function ProgramSessionPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const sessionId = String(params?.id || '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [session, setSession] = useState<TrainingSession | null>(null);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [actualRepsInput, setActualRepsInput] = useState('');

  const [restSeconds, setRestSeconds] = useState(0);
  const [restPaused, setRestPaused] = useState(false);

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastBeepSecondRef = useRef<number | null>(null);
  const wakeLockRef = useRef<any>(null);

  const currentSet = useMemo(() => {
    if (!session) return null;
    return session.sets[currentIdx] || null;
  }, [session, currentIdx]);

  const load = async (forceStartEarly = false) => {
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    try {
      const init: RequestInit = forceStartEarly
        ? {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ forceStartEarly: true }),
          }
        : { method: 'POST' };
      const res = await fetchJson(`/api/program/session/${sessionId}/start`, init);
      const p = (res.program || null) as ProgramDetail | null;
      setProgram(p);

      const s = p?.sessions.find((x) => x.id === sessionId) || null;
      setSession(s);

      if (!s) {
        setError('Сессия не найдена');
      } else if (s.completed) {
        setDone(true);
      } else {
        const idx = s.sets.findIndex((x) => x.actualReps == null);
        const firstIdx = idx >= 0 ? idx : s.sets.length - 1;
        setCurrentIdx(firstIdx);
        const target = s.sets[firstIdx]?.targetReps ?? 1;
        setActualRepsInput(String(target));
      }
    } catch (e: any) {
      if (e?.code === 'REST_PERIOD_NOT_FINISHED' && !forceStartEarly) {
        const ok = window.confirm(
          `${e?.message || 'Период отдыха ещё не завершён.'}\n\nНачать тренировку раньше срока? Это сдвинет даты последующих тренировок.`,
        );
        if (ok) {
          await load(true);
          return;
        }
      }
      setError(e?.message || 'Не удалось открыть тренировку');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (restSeconds <= 0 || restPaused) return;
    const t = window.setInterval(() => setRestSeconds((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => window.clearInterval(t);
  }, [restSeconds, restPaused]);

  const releaseWakeLock = useCallback(async () => {
    const sentinel = wakeLockRef.current;
    wakeLockRef.current = null;
    if (!sentinel) return;
    try {
      await sentinel.release();
    } catch {}
  }, []);

  const requestWakeLock = useCallback(async () => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (document.visibilityState !== 'visible') return;
    if (wakeLockRef.current) return;

    const wakeLockApi = (navigator as any)?.wakeLock;
    if (!wakeLockApi?.request) return;

    try {
      const sentinel = await wakeLockApi.request('screen');
      wakeLockRef.current = sentinel;
      sentinel?.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {}
  }, []);

  const playCountdownBeep = useCallback(() => {
    if (typeof window === 'undefined') return;
    const AudioCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtor) return;

    if (!audioContextRef.current) audioContextRef.current = new AudioCtor();
    const ctx = audioContextRef.current;

    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 920;

    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.14);

    oscillator.connect(gain);
    gain.connect(ctx.destination);

    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.15);
  }, []);

  useEffect(() => {
    if (restPaused || restSeconds <= 0) {
      lastBeepSecondRef.current = null;
      return;
    }

    if (restSeconds <= 5 && lastBeepSecondRef.current !== restSeconds) {
      lastBeepSecondRef.current = restSeconds;
      playCountdownBeep();
    }
  }, [restSeconds, restPaused, playCountdownBeep]);

  useEffect(() => {
    const shouldKeepAwake = restSeconds > 0 && !restPaused && !done;
    if (shouldKeepAwake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [restSeconds, restPaused, done, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    const onVisibility = () => {
      const shouldKeepAwake = restSeconds > 0 && !restPaused && !done;
      if (!shouldKeepAwake) {
        releaseWakeLock();
        return;
      }
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      } else {
        releaseWakeLock();
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [restSeconds, restPaused, done, requestWakeLock, releaseWakeLock]);

  useEffect(() => {
    return () => {
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      releaseWakeLock();
    };
  }, [releaseWakeLock]);

  useEffect(() => {
    if (restSeconds !== 0 || !session) return;
    if (!session.sets[currentIdx]) return;

    const st = session.sets[currentIdx];
    if (st.actualReps == null) return;

    const next = session.sets[currentIdx + 1];
    if (!next) return;

    setActualRepsInput(String(next.targetReps));
  }, [restSeconds, session, currentIdx]);

  const saveCurrentSet = async () => {
    if (!session || !currentSet) return;

    const actualReps = sanitizePositiveInt(actualRepsInput);
    if (!Number.isFinite(actualReps) || actualReps <= 0) {
      setError('Введите корректное число повторений (> 0)');
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      await fetchJson(`/api/program/session/${session.id}/set/${currentSet.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ actualReps }),
      });

      setSession((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          sets: prev.sets.map((s) => (s.id === currentSet.id ? { ...s, actualReps } : s)),
        };
      });

      const isLast = currentIdx >= session.sets.length - 1;
      if (isLast) {
        await fetchJson(`/api/program/session/${session.id}/complete`, { method: 'POST' });
        setDone(true);
        setInfo('Тренировка завершена. Подходы сохранены.');
        return;
      }

      setRestSeconds(currentSet.restSeconds || 0);
      setRestPaused(false);
      setCurrentIdx((x) => x + 1);
      const nextSet = session.sets[currentIdx + 1];
      if (nextSet) setActualRepsInput(String(nextSet.targetReps));
      setInfo(`Подход ${currentSet.setNumber} записан`);
    } catch (e: any) {
      setError(e?.message || 'Ошибка записи подхода');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="app-page" style={{ maxWidth: 760 }}>Загрузка…</div>;

  return (
    <div className="app-page" style={{ maxWidth: 760 }}>
      <h1 style={{ marginBottom: 8 }}>Тренировка по программе</h1>

      {program && session ? (
        <div style={{ color: '#111827', marginBottom: 12 }}>
          {exerciseLabel(program.exerciseType)} · неделя {session.weekNumber} · тренировка #{session.sessionNumber}
          {session.isFinalTest ? ' · финальный тест' : ''}
        </div>
      ) : null}

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {info ? <p style={{ color: '#16a34a' }}>{info}</p> : null}

      {!done && session && currentSet ? (
        <section style={card}>
          {restSeconds > 0 ? (
            <div style={restWrap}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Отдых перед следующим подходом</div>
              <div style={restTimer}>
                {Math.floor(restSeconds / 60)}:{String(restSeconds % 60).padStart(2, '0')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button type="button" style={btnSecondary} onClick={() => setRestPaused((x) => !x)}>
                  {restPaused ? 'Продолжить' : 'Пауза'}
                </button>
                <button type="button" style={btnSecondary} onClick={() => setRestSeconds(0)}>Пропустить</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
              <div style={{ fontWeight: 900, textAlign: 'center' }}>
                Подход {currentSet.setNumber}/{session.sets.length} {currentSet.isKeySet ? '· max' : ''}
              </div>
              <div style={{ textAlign: 'center' }}>Цель: <b>{currentSet.targetReps}</b> повторений</div>

              <div style={setInputWrap}>
                <input
                  inputMode="numeric"
                  value={actualRepsInput}
                  onChange={(e) => setActualRepsInput(String(sanitizePositiveInt(e.target.value)))}
                  style={repsInputStyle}
                />

                <div style={controlsGrid}>
                  <button
                    type="button"
                    style={minusBtn}
                    onClick={() => {
                      const next = Math.max(1, sanitizePositiveInt(actualRepsInput) - 1);
                      setActualRepsInput(String(next));
                    }}
                  >
                    -
                  </button>
                  <button
                    type="button"
                    style={plusBtn}
                    onClick={() => {
                      const next = Math.min(5000, Math.max(0, sanitizePositiveInt(actualRepsInput)) + 1);
                      setActualRepsInput(String(next));
                    }}
                  >
                    +
                  </button>
                </div>

                <button type="button" style={{ ...btnPrimary, width: '100%' }} onClick={saveCurrentSet} disabled={saving}>
                  {saving ? 'Сохранение…' : 'Сделал'}
                </button>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {done ? (
        <section style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Выполнено</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/program" style={btnLink}>К программе</Link>
            <button type="button" style={btnSecondary} onClick={() => router.push('/dashboard')}>На тренировку</button>
          </div>
        </section>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Link href="/program" style={btnLink}>← Назад к расписанию</Link>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
  overflow: 'hidden',
};

const setInputWrap: React.CSSProperties = {
  width: 'min(100%, 520px)',
  maxWidth: '100%',
  display: 'grid',
  gap: 12,
};

const repsInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  minWidth: 0,
  textAlign: 'center',
  fontWeight: 800,
  fontSize: 'clamp(54px, 16vw, 140px)',
  lineHeight: 1.05,
  padding: '12px 10px',
  borderRadius: 16,
  border: '2px solid #e5e7eb',
  outline: 'none',
  color: '#000',
  background: '#fff',
};

const controlsGrid: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const plusMinusBase: React.CSSProperties = {
  height: 'clamp(64px, 17vw, 110px)',
  width: '100%',
  borderRadius: 14,
  border: 'none',
  color: '#000',
  fontWeight: 800,
  fontSize: 'clamp(40px, 10vw, 64px)',
  lineHeight: 1,
  cursor: 'pointer',
};

const plusBtn: React.CSSProperties = {
  ...plusMinusBase,
  background: '#22c55e',
};

const minusBtn: React.CSSProperties = {
  ...plusMinusBase,
  background: '#ef4444',
};

const restWrap: React.CSSProperties = {
  minHeight: '52vh',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  gap: 14,
};

const restTimer: React.CSSProperties = {
  fontWeight: 900,
  lineHeight: 1,
  fontSize: 'clamp(76px, 23vw, 180px)',
  letterSpacing: 2,
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
