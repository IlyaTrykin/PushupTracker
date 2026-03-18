'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getLocaleTimerAudio } from '@/i18n/locale';
import { t } from '@/i18n/translate';
import { exerciseValueLabel, formatExerciseValue, isTimedExercise } from '@/lib/exercise-metrics';

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

type JsonObject = Record<string, unknown>;

type ApiError = Error & {
  code?: string;
  status?: number;
};

type WakeLockSentinelLike = {
  release: () => Promise<void>;
  addEventListener?: (type: 'release', listener: () => void) => void;
};

type NavigatorWithWakeLock = Navigator & {
  wakeLock?: {
    request?: (type: 'screen') => Promise<WakeLockSentinelLike>;
  };
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: typeof AudioContext;
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

function exerciseLabel(
  exerciseType: string,
  labels: {
    pushups: string;
    pullups: string;
    crunches: string;
    squats: string;
    plank: string;
  },
) {
  if (exerciseType === 'pushups') return labels.pushups;
  if (exerciseType === 'pullups') return labels.pullups;
  if (exerciseType === 'crunches') return labels.crunches;
  if (exerciseType === 'squats') return labels.squats;
  if (exerciseType === 'plank') return labels.plank;
  return exerciseType;
}

function sanitizePositiveInt(value: string): number {
  const onlyDigits = value.replace(/[^\d]/g, '');
  const n = Number(onlyDigits || 0);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(5000, Math.round(n));
}

function formatText(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

export default function ProgramSessionPage() {
  const { locale, messages } = useI18n();
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
  const [plankSecondsLeft, setPlankSecondsLeft] = useState(0);
  const [plankActive, setPlankActive] = useState(false);

  const [restSeconds, setRestSeconds] = useState(0);
  const [restPaused, setRestPaused] = useState(false);

  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const lastBeepSecondRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinelLike | null>(null);
  const prepareAudioRef = useRef<HTMLAudioElement | null>(null);
  const startAudioRef = useRef<HTMLAudioElement | null>(null);
  const prevRestSecondsRef = useRef(0);

  const currentSet = useMemo(() => {
    if (!session) return null;
    return session.sets[currentIdx] || null;
  }, [session, currentIdx]);
  const isFinalCountdown = restSeconds > 0 && restSeconds <= 5;
  const isPlank = isTimedExercise(program?.exerciseType);
  const isPlankFinalCountdown = plankActive && plankSecondsLeft > 0 && plankSecondsLeft <= 3;
  const timerAudio = useMemo(() => getLocaleTimerAudio(locale), [locale]);
  const metricInputLabel = useMemo(
    () => exerciseValueLabel(program?.exerciseType),
    [program?.exerciseType],
  );
  const plankElapsedSeconds = useMemo(() => {
    if (!currentSet || !isPlank) return 0;
    return Math.max(0, currentSet.targetReps - plankSecondsLeft);
  }, [currentSet, isPlank, plankSecondsLeft]);
  const currentSetId = currentSet?.id ?? null;
  const currentTargetReps = currentSet?.targetReps ?? 0;

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
      const response = isJsonObject(res) ? res : null;
      const p = response && isJsonObject(response.program) ? (response.program as ProgramDetail) : null;
      setProgram(p);

      const s = p?.sessions.find((x) => x.id === sessionId) || null;
      setSession(s);

      if (!s) {
        setError(messages.programSession.errors.sessionNotFound);
      } else if (s.completed) {
        setDone(true);
      } else {
        const idx = s.sets.findIndex((x) => x.actualReps == null);
        const firstIdx = idx >= 0 ? idx : s.sets.length - 1;
        setCurrentIdx(firstIdx);
        const target = s.sets[firstIdx]?.targetReps ?? 1;
        setActualRepsInput(String(target));
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
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  useEffect(() => {
    if (restSeconds <= 0 || restPaused) return;
    const t = window.setInterval(() => setRestSeconds((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => window.clearInterval(t);
  }, [restSeconds, restPaused]);

  useEffect(() => {
    if (!isPlank || currentSetId == null) {
      setPlankActive(false);
      setPlankSecondsLeft(0);
      return;
    }
    setPlankActive(false);
    setPlankSecondsLeft(Math.max(1, currentTargetReps));
  }, [currentSetId, currentTargetReps, isPlank]);

  useEffect(() => {
    if (!isPlank || !plankActive || plankSecondsLeft <= 0 || saving) return;
    const t = window.setInterval(() => setPlankSecondsLeft((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => window.clearInterval(t);
  }, [isPlank, plankActive, plankSecondsLeft, saving]);

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

    const wakeLockApi = (navigator as NavigatorWithWakeLock).wakeLock;
    if (!wakeLockApi?.request) return;

    try {
      const sentinel = await wakeLockApi.request('screen');
      wakeLockRef.current = sentinel;
      sentinel?.addEventListener?.('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null;
      });
    } catch {}
  }, []);

  const getAudioElements = useCallback(() => {
    if (typeof window === 'undefined') return null;
    const prepareSrc = timerAudio.prepare;
    const startSrc = timerAudio.start;

    if (!prepareAudioRef.current) {
      prepareAudioRef.current = new Audio(prepareSrc);
      prepareAudioRef.current.preload = 'auto';
      prepareAudioRef.current.dataset.clipSrc = prepareSrc;
    } else if (prepareAudioRef.current.dataset.clipSrc !== prepareSrc) {
      prepareAudioRef.current.pause();
      prepareAudioRef.current.src = prepareSrc;
      prepareAudioRef.current.load();
      prepareAudioRef.current.dataset.clipSrc = prepareSrc;
    }
    if (!startAudioRef.current) {
      startAudioRef.current = new Audio(startSrc);
      startAudioRef.current.preload = 'auto';
      startAudioRef.current.dataset.clipSrc = startSrc;
    } else if (startAudioRef.current.dataset.clipSrc !== startSrc) {
      startAudioRef.current.pause();
      startAudioRef.current.src = startSrc;
      startAudioRef.current.load();
      startAudioRef.current.dataset.clipSrc = startSrc;
    }
    const mediaSession = navigator.mediaSession;
    const MediaMetadataCtor = window.MediaMetadata;
    if (mediaSession && MediaMetadataCtor) {
      mediaSession.metadata = new MediaMetadataCtor({
        title: messages.programSession.rest.mediaTitle,
        artist: messages.common.appName,
        album: messages.programSession.rest.mediaAlbum,
        artwork: [
          { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-1024.png', sizes: '1024x1024', type: 'image/png' },
        ],
      });
    }
    return { prepare: prepareAudioRef.current, start: startAudioRef.current };
  }, [messages.common.appName, messages.programSession.rest.mediaAlbum, messages.programSession.rest.mediaTitle, timerAudio.prepare, timerAudio.start]);

  const primeAudioPlayback = useCallback(async () => {
    if (typeof window !== 'undefined') {
      const AudioCtor = window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
      if (AudioCtor) {
        if (!audioContextRef.current) audioContextRef.current = new AudioCtor();
        if (audioContextRef.current.state === 'suspended') {
          try {
            await audioContextRef.current.resume();
          } catch {}
        }
      }
    }

    const audio = getAudioElements();
    if (!audio) return;

    await Promise.all(Object.values(audio).map(async (clip) => {
      try {
        clip.muted = true;
        clip.currentTime = 0;
        await clip.play();
        clip.pause();
        clip.currentTime = 0;
        clip.muted = false;
      } catch {}
    }));
  }, [getAudioElements]);

  const playCountdownBeep = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!ctx || ctx.state !== 'running') return;

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

  const playVoiceAnnouncement = useCallback((kind: 'prepare' | 'start') => {
    const audio = getAudioElements()?.[kind];
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
      void audio.play().catch(() => {});
    } catch {}
  }, [getAudioElements]);

  useEffect(() => {
    const prevRestSeconds = prevRestSecondsRef.current;
    prevRestSecondsRef.current = restSeconds;

    if (!restPaused && prevRestSeconds > 0 && restSeconds === 0) {
      playVoiceAnnouncement('start');
    }
    if (restPaused || restSeconds <= 0) {
      lastBeepSecondRef.current = null;
      return;
    }
    if (restSeconds === 5 && prevRestSeconds !== 5) {
      playVoiceAnnouncement('prepare');
    }
    if (restSeconds <= 3 && lastBeepSecondRef.current !== restSeconds) {
      lastBeepSecondRef.current = restSeconds;
      playCountdownBeep();
    }
  }, [restSeconds, restPaused, playVoiceAnnouncement, playCountdownBeep]);

  useEffect(() => {
    if (!isPlank || !plankActive || plankSecondsLeft <= 0) {
      return;
    }
    if (plankSecondsLeft <= 3) {
      playCountdownBeep();
    }
  }, [isPlank, plankActive, plankSecondsLeft, playCountdownBeep]);

  useEffect(() => {
    const shouldKeepAwake = (restSeconds > 0 && !restPaused && !done) || (isPlank && plankActive && plankSecondsLeft > 0 && !done);
    if (shouldKeepAwake) {
      requestWakeLock();
    } else {
      releaseWakeLock();
    }
  }, [restSeconds, restPaused, done, requestWakeLock, releaseWakeLock, isPlank, plankActive, plankSecondsLeft]);

  useEffect(() => {
    const onVisibility = () => {
      const shouldKeepAwake = (restSeconds > 0 && !restPaused && !done) || (isPlank && plankActive && plankSecondsLeft > 0 && !done);
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
  }, [restSeconds, restPaused, done, requestWakeLock, releaseWakeLock, isPlank, plankActive, plankSecondsLeft]);

  useEffect(() => {
    return () => {
      prepareAudioRef.current?.pause();
      startAudioRef.current?.pause();
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

  const saveCurrentSet = useCallback(async (actualValue?: number) => {
    if (!session || !currentSet) return;

    const actualReps = actualValue ?? sanitizePositiveInt(actualRepsInput);
    if (!Number.isFinite(actualReps) || actualReps <= 0) {
      setError(isTimedExercise(program?.exerciseType) ? t(locale, 'Введите корректное количество секунд (> 0)') : messages.programSession.errors.invalidReps);
      return;
    }

    setSaving(true);
    setError(null);
    setInfo(null);

    try {
      await primeAudioPlayback();
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
        setInfo(messages.programSession.complete.info);
        return;
      }

      setRestSeconds(currentSet.restSeconds || 0);
      setRestPaused(false);
      setPlankActive(false);
      setCurrentIdx((x) => x + 1);
      const nextSet = session.sets[currentIdx + 1];
      if (nextSet) setActualRepsInput(String(nextSet.targetReps));
      setInfo(formatText(messages.programSession.set.saved, { setNumber: currentSet.setNumber }));
    } catch (e: unknown) {
      setError(getErrorMessage(e, messages.programSession.errors.saveSetFailed));
    } finally {
      setSaving(false);
    }
  }, [session, currentSet, actualRepsInput, program?.exerciseType, locale, messages.programSession.errors.invalidReps, messages.programSession.errors.saveSetFailed, messages.programSession.complete.info, messages.programSession.set.saved, currentIdx, primeAudioPlayback]);

  useEffect(() => {
    if (!isPlank || !plankActive || plankSecondsLeft !== 0 || saving || !currentSet) return;
    setPlankActive(false);
    void saveCurrentSet(currentSet.targetReps);
  }, [isPlank, plankActive, plankSecondsLeft, saving, currentSet, saveCurrentSet]);

  function formatClock(totalSeconds: number): string {
    const safe = Math.max(0, totalSeconds);
    const mm = Math.floor(safe / 60);
    const ss = safe % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  if (loading) return <div className="app-page" style={{ maxWidth: 760 }}>{messages.common.loading}</div>;

  return (
    <div className="app-page" style={{ maxWidth: 760 }}>
      {program && session ? (
        <div style={{ color: '#111827', marginBottom: 12 }}>
          {exerciseLabel(program.exerciseType, messages.nav.exercise)} · {messages.programSession.header.week} {session.weekNumber} · {messages.programSession.header.workout} #{session.sessionNumber}
          {session.isFinalTest ? ` · ${messages.programSession.header.finalTest}` : ''}
        </div>
      ) : null}

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {info ? <p style={{ color: '#16a34a' }}>{info}</p> : null}

      {!done && session && currentSet ? (
        <section style={card}>
          {restSeconds > 0 ? (
            <div style={restWrap}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{messages.programSession.rest.title}</div>
              <div style={{ ...restTimer, ...(isFinalCountdown ? restTimerDanger : null) }}>
                {Math.floor(restSeconds / 60)}:{String(restSeconds % 60).padStart(2, '0')}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={async () => {
                    await primeAudioPlayback();
                    setRestPaused((x) => !x);
                  }}
                >
                  {restPaused ? messages.programSession.rest.resume : messages.programSession.rest.pause}
                </button>
                <button
                  type="button"
                  style={btnSecondary}
                  onClick={async () => {
                    await primeAudioPlayback();
                    setRestSeconds(0);
                  }}
                >
                  {messages.programSession.rest.skip}
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
              <div style={{ fontWeight: 900, textAlign: 'center' }}>
                {formatText(messages.programSession.set.title, {
                  current: currentSet.setNumber,
                  total: session.sets.length,
                  maxSuffix: currentSet.isKeySet ? messages.programSession.set.maxSuffix : '',
                })}
              </div>
              <div style={{ textAlign: 'center' }}>
                {isTimedExercise(program?.exerciseType)
                  ? `${t(locale, 'Цель')}: ${formatExerciseValue(currentSet.targetReps, program?.exerciseType, true)}`
                  : formatText(messages.programSession.set.target, { reps: currentSet.targetReps })}
              </div>

              {isPlank ? (
                <div style={setInputWrap}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', textAlign: 'center' }}>{t(locale, 'Осталось')}</div>
                  <div style={{ ...repsInputStyle, display: 'flex', alignItems: 'center', justifyContent: 'center', ...(isPlankFinalCountdown ? restTimerDanger : null) }}>
                    {formatClock(plankSecondsLeft)}
                  </div>
                  <div style={{ fontSize: 14, color: '#475569', textAlign: 'center', fontWeight: 800 }}>
                    {t(locale, 'Сделал')}: {formatExerciseValue(plankElapsedSeconds, program?.exerciseType, true)}
                  </div>
                  <div style={controlsGrid}>
                    <button
                      type="button"
                      style={minusBtn}
                      onClick={async () => {
                        await primeAudioPlayback();
                        setPlankActive((prev) => !prev);
                      }}
                    >
                      {plankActive ? messages.programSession.rest.pause : plankElapsedSeconds > 0 ? messages.programSession.rest.resume : t(locale, 'Старт')}
                    </button>
                    <button
                      type="button"
                      style={plusBtn}
                      onClick={() => {
                        setPlankActive(false);
                        void saveCurrentSet(plankElapsedSeconds);
                      }}
                      disabled={saving || plankElapsedSeconds <= 0}
                    >
                      {saving ? messages.programSession.set.saving : messages.programSession.set.done}
                    </button>
                  </div>
                </div>
              ) : (
                <div style={setInputWrap}>
                  <div style={{ fontSize: 12, fontWeight: 800, color: '#475569', textAlign: 'center' }}>{t(locale, metricInputLabel)}</div>
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

                  <button type="button" style={{ ...btnPrimary, width: '100%' }} onClick={() => void saveCurrentSet()} disabled={saving}>
                    {saving ? messages.programSession.set.saving : messages.programSession.set.done}
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      ) : null}

      {done ? (
        <section style={card}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>{messages.programSession.complete.title}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/program" style={btnLink}>{messages.programSession.complete.toProgram}</Link>
            <button type="button" style={btnSecondary} onClick={() => router.push('/dashboard')}>{messages.programSession.complete.toDashboard}</button>
          </div>
        </section>
      ) : null}

      <div style={{ marginTop: 12 }}>
        <Link href="/program" style={btnLink}>{messages.programSession.complete.backToSchedule}</Link>
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

const restTimerDanger: React.CSSProperties = {
  color: '#dc2626',
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
