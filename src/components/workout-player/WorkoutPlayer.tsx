'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '@/i18n/provider';
import { circuitsMessages } from '@/i18n/messages/features/circuits';
import RepCounterButtons from '@/app/dashboard/RepCounterButtons';
import { exerciseIcon, exerciseLabel, isDistanceExercise, isTimedExercise } from '@/lib/exercises';
import { formatDuration, formatExerciseValue } from '@/lib/exercise-metrics';
import { formatDurationTyping, parseDurationInput } from '@/lib/workout-input';
import { resumeStepIndex, upcomingExercise, type PlayerStep, type StepResult } from '@/lib/workout-player';
import { useScreenWakeLock, useTimerSound, vibrate } from './feedback';
import styles from './WorkoutPlayer.module.css';

export type WorkoutPlayerProps = {
  /** План: разминка / упражнение / отдых (`programSessionSteps`, `circuitRunSteps`). */
  steps: PlayerStep[];
  /** Id уже записанных упражнений (подходы с сервера, станции разового круга). */
  done: ReadonlySet<string>;
  /** Ключ на устройстве: пройдена ли разминка — чтобы «Продолжить» не начинал с неё снова. */
  resumeKey: string;
  /**
   * «Готово» упражнения (и конец/пропуск разминки — с пустым результатом). Запись делает страница;
   * ошибка (`throw`) показывается под кнопкой, шаг остаётся.
   */
  onStepDone(step: PlayerStep, result: StepResult): Promise<void>;
  /** Последний шаг пройден. */
  onComplete(): void;
  /** Кнопка «i» рядом с прогрессом (безопасность у круговых). */
  info?: ReactNode;
};

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    if (on) window.localStorage.setItem(key, '1');
    else window.localStorage.removeItem(key);
  } catch {}
}

function formatKg(kg: number, locale: string): string {
  const text = String(Math.round(kg * 10) / 10);
  return locale === 'en' ? text : text.replace('.', ',');
}

function digitsOnly(raw: string, max = 99999): string {
  const n = Number(raw.replace(/\D/g, '') || 0);
  return n > 0 ? String(Math.min(max, n)) : '';
}

/**
 * Пошаговое занятие: текущее упражнение крупно с целью и вводом результата, «Готово», таймер
 * отдыха между подходами/станциями/кругами (пауза, пропуск, голос, сигнал, вибрация, экран не
 * гаснет), следующий шаг виден заранее. Про API ничего не знает — запись делает страница.
 */
export default function WorkoutPlayer({ steps, done, resumeKey, onStepDone, onComplete, info }: WorkoutPlayerProps) {
  const { locale, messages } = useI18n();
  const text = circuitsMessages[locale].player;
  const sound = useTimerSound(locale, {
    title: messages.programSession.rest.mediaTitle,
    artist: messages.common.appName,
    album: messages.programSession.rest.mediaAlbum,
  });

  const [warmupDone, setWarmupDone] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setWarmupDone(readFlag(resumeKey));
    setReady(true);
  }, [resumeKey]);

  const startIndex = useMemo(() => resumeStepIndex(steps, done, { warmupDone }), [steps, done, warmupDone]);
  const [index, setIndex] = useState<number | null>(null);
  const [timerLeft, setTimerLeft] = useState(0);
  const [paused, setPaused] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [holdRunning, setHoldRunning] = useState(false);
  const busyRef = useRef(false);
  const prevLeftRef = useRef(0);
  const completedRef = useRef(false);

  const step = index != null ? steps[index] ?? null : null;
  const timed = step?.kind === 'rest' || step?.kind === 'warmup';
  const exerciseCount = useMemo(() => steps.filter((s) => s.kind === 'exercise').length, [steps]);

  const finish = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    writeFlag(resumeKey, false);
    onComplete();
  }, [onComplete, resumeKey]);

  const goTo = useCallback(
    (next: number) => {
      setError(null);
      if (next >= steps.length) {
        setIndex(steps.length);
        finish();
        return;
      }
      const target = steps[next];
      setIndex(next);
      setPaused(false);
      setHoldRunning(false);
      setTimerLeft(target.kind === 'exercise' ? 0 : Math.max(1, target.seconds ?? 0));
      prevLeftRef.current = 0;
    },
    [finish, steps],
  );

  const passWarmup = useCallback(
    (warmup: PlayerStep, at: number) => {
      writeFlag(resumeKey, true);
      setWarmupDone(true);
      void onStepDone(warmup, {}).catch(() => {});
      goTo(at + 1);
    },
    [goTo, onStepDone, resumeKey],
  );

  // Таймер отдыха и разминки.
  useEffect(() => {
    if (!timed || paused || timerLeft <= 0) return;
    const id = window.setInterval(() => setTimerLeft((x) => (x > 0 ? x - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [timed, paused, timerLeft]);

  // Голос «приготовьтесь» за 5 с, сигнал на 3-2-1, в ноль — «старт», вибрация и следующий шаг.
  useEffect(() => {
    if (!timed || index == null || !step) return;
    const prev = prevLeftRef.current;
    prevLeftRef.current = timerLeft;
    if (paused) return;
    if (timerLeft === 5 && prev !== 5) sound.voice('prepare');
    if (timerLeft > 0 && timerLeft <= 3 && prev !== timerLeft) sound.beep();
    if (prev > 0 && timerLeft === 0) {
      sound.voice('start');
      vibrate();
      if (step.kind === 'warmup') passWarmup(step, index);
      else goTo(index + 1);
    }
  }, [timerLeft, paused, timed, index, step, sound, goTo, passWarmup]);

  useScreenWakeLock((timed && !paused && timerLeft > 0) || holdRunning);

  const begin = async () => {
    await sound.prime();
    completedRef.current = false;
    goTo(startIndex);
  };

  const submit = async (result: StepResult) => {
    if (!step || index == null || busyRef.current) return;
    busyRef.current = true;
    setSaving(true);
    setError(null);
    try {
      await sound.prime();
      await onStepDone(step, result);
      goTo(index + 1);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : text.invalid);
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  };

  if (!ready) return null;

  if (index == null) {
    const resuming = startIndex > 0 && startIndex < steps.length;
    // У круга план — станции одного круга и число кругов (иначе список на 20–30 строк).
    const rounds = Math.max(0, ...steps.map((s) => s.rounds ?? 0));
    const planSteps = steps.filter((s) => s.kind === 'warmup' || (s.kind === 'exercise' && (rounds === 0 || s.round === 1)));
    return (
      <section className={styles.card} data-testid="player-intro">
        {resuming ? <p className={styles.lead}>{text.resumeHint(startIndex + 1, steps.length)}</p> : null}
        <button type="button" className={styles.primary} onClick={() => void begin()} data-testid="player-start">
          {resuming ? text.resume : text.start}
        </button>
        <div className={styles.planTitle}>
          {text.planTitle}
          {rounds > 1 ? ` · ${text.rounds(rounds)}` : ''}
        </div>
        <ol className={styles.planList}>
          {planSteps.map((s) =>
            s.kind === 'warmup' ? (
              <li key={s.id} className={warmupDone || startIndex > 0 ? styles.planDone : undefined}>
                {text.warmup.title} · {formatDuration(s.seconds ?? 0)}
              </li>
            ) : (
              <li key={s.id} className={rounds <= 1 && done.has(s.id) ? styles.planDone : undefined}>
                {stepLine(s, locale)}
              </li>
            ),
          )}
        </ol>
      </section>
    );
  }

  if (!step) return null;

  const position = steps.slice(0, index + 1).filter((s) => s.kind === 'exercise').length;
  const upcoming = upcomingExercise(steps, index);
  const restAfter = step.kind === 'exercise' && steps[index + 1]?.kind === 'rest' ? steps[index + 1].seconds ?? 0 : 0;

  return (
    <section className={styles.card} data-testid="workout-player">
      <div className={styles.progressRow}>
        <span>{text.progress(index + 1, steps.length)}</span>
        {info}
      </div>
      <div className={styles.progressBar} aria-hidden="true">
        <span style={{ width: `${Math.round((position / Math.max(1, exerciseCount)) * 100)}%` }} />
      </div>

      {step.kind === 'warmup' ? (
        <div className={styles.timerWrap} data-testid="player-warmup">
          <div className={styles.stepTitle}>{text.warmup.title}</div>
          <ul className={styles.moves}>
            {text.warmup.moves.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <div className={`${styles.clock} ${timerLeft <= 5 ? styles.clockDanger : ''}`}>{formatDuration(timerLeft)}</div>
          <div className={styles.buttonsRow}>
            <button
              type="button"
              className={styles.secondary}
              onClick={async () => {
                await sound.prime();
                setPaused((p) => !p);
              }}
            >
              {paused ? text.rest.resume : text.rest.pause}
            </button>
            <button type="button" className={styles.secondary} onClick={() => passWarmup(step, index)} data-testid="player-skip-warmup">
              {text.warmup.skip}
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === 'rest' ? (
        <div className={styles.timerWrap} data-testid="player-rest">
          <div className={styles.stepTitle}>
            {upcoming?.station === 1 && (upcoming.round ?? 1) > 1 ? text.rest.betweenRounds : text.rest.title}
          </div>
          <div className={`${styles.clock} ${timerLeft <= 5 ? styles.clockDanger : ''}`}>{formatDuration(timerLeft)}</div>
          <div className={styles.buttonsRow}>
            <button
              type="button"
              className={styles.secondary}
              onClick={async () => {
                await sound.prime();
                setPaused((p) => !p);
              }}
            >
              {paused ? text.rest.resume : text.rest.pause}
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={async () => {
                await sound.prime();
                goTo(index + 1);
              }}
              data-testid="player-skip-rest"
            >
              {text.rest.skip}
            </button>
          </div>
        </div>
      ) : null}

      {step.kind === 'exercise' ? (
        <ExerciseStep
          key={step.id}
          step={step}
          saving={saving}
          onSubmit={(r) => void submit(r)}
          onHoldRunning={setHoldRunning}
          beep={sound.beep}
          voice={sound.voice}
          prime={sound.prime}
        />
      ) : null}

      {error ? (
        <p className={styles.error} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.next} data-testid="player-next">
        <span className={styles.nextLabel}>{text.next}:</span>{' '}
        {upcoming ? (
          <>
            {restAfter > 0 ? `${text.nextRest(restAfter)} → ` : ''}
            {stepLine(upcoming, locale)}
          </>
        ) : (
          text.lastStep
        )}
      </div>
    </section>
  );
}

/** «Приседания · 15», «Боковая планка · 20 с / сторона», «Махи гирей · 15 · 16 кг». */
function stepLine(step: PlayerStep, locale: 'ru' | 'en'): string {
  const text = circuitsMessages[locale].player;
  const parts = [exerciseLabel(step.exerciseType, locale), formatExerciseValue(step.target ?? 0, step.exerciseType, true, locale)];
  if (step.perSide) parts[1] += ` (${text.perSide})`;
  if (step.loadKg != null) parts.push(`${formatKg(step.loadKg, locale)} ${locale === 'en' ? 'kg' : 'кг'}`);
  return parts.join(' · ');
}

type ExerciseStepProps = {
  step: PlayerStep;
  saving: boolean;
  onSubmit(result: StepResult): void;
  onHoldRunning(running: boolean): void;
  beep(): void;
  voice(kind: 'prepare' | 'start'): void;
  prime(): Promise<void>;
};

function ExerciseStep({ step, saving, onSubmit, onHoldRunning, beep, voice, prime }: ExerciseStepProps) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].player;
  const type = step.exerciseType ?? '';
  const target = step.target ?? 0;
  const timedKind = isTimedExercise(type);
  const distance = isDistanceExercise(type);

  return (
    <div className={styles.exercise} data-testid="player-exercise">
      <div className={styles.meta}>
        {step.round != null && step.station != null && step.rounds && step.stations
          ? text.roundStation(step.round, step.rounds, step.station, step.stations)
          : step.setNumber && step.totalSets
            ? text.set(step.setNumber, step.totalSets)
            : null}
      </div>
      <div className={styles.exerciseHead}>
        <Image src={exerciseIcon(type)} alt="" width={48} height={48} unoptimized className={styles.exerciseIcon} />
        <div className={styles.exerciseName}>{exerciseLabel(type, locale)}</div>
      </div>
      <div className={styles.targetLine}>
        {text.target}: <b>{formatExerciseValue(target, type, true, locale)}</b>
        {step.perSide ? ` ${text.perSide}` : ''}
        {step.loadKg != null ? <span className={styles.load}>{text.load(formatKg(step.loadKg, locale))}</span> : null}
      </div>

      {timedKind ? (
        <HoldInput step={step} saving={saving} onSubmit={onSubmit} onRunning={onHoldRunning} beep={beep} voice={voice} prime={prime} />
      ) : distance ? (
        <DistanceInput target={target} saving={saving} onSubmit={onSubmit} />
      ) : step.perSide ? (
        <SidesInput target={target} saving={saving} onSubmit={onSubmit} />
      ) : (
        <RepsInput type={type} target={target} saving={saving} onSubmit={onSubmit} />
      )}
    </div>
  );
}

function Stepper({ value, onChange, label, testId }: { value: string; onChange(v: string): void; label: string; testId?: string }) {
  const n = Number(value || 0);
  return (
    <div className={styles.stepper}>
      <div className={styles.inputLabel}>{label}</div>
      <input
        inputMode="numeric"
        className={styles.bigInput}
        value={value}
        onChange={(e) => onChange(digitsOnly(e.target.value, 5000))}
        aria-label={label}
        data-testid={testId}
      />
      <div className={styles.pmRow}>
        <button type="button" className={styles.minus} onClick={() => onChange(String(Math.max(0, n - 1)))} aria-label="−1">
          −
        </button>
        <button type="button" className={styles.plus} onClick={() => onChange(String(Math.min(5000, n + 1)))} aria-label="+1">
          +
        </button>
      </div>
    </div>
  );
}

function DoneButton({ saving, disabled, onClick }: { saving: boolean; disabled?: boolean; onClick(): void }) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].player;
  return (
    <button type="button" className={styles.primary} onClick={onClick} disabled={saving || disabled} data-testid="player-done">
      {saving ? text.saving : text.done}
    </button>
  );
}

function RepsInput({ type, target, saving, onSubmit }: { type: string; target: number; saving: boolean; onSubmit(r: StepResult): void }) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].player;
  const [value, setValue] = useState(String(target));
  return (
    <div className={styles.inputs}>
      <Stepper value={value} onChange={setValue} label={text.reps} testId="player-value" />
      <RepCounterButtons exerciseType={type} locale={locale} disabled={saving} onCounted={(count) => setValue(String(count))} />
      <DoneButton saving={saving} disabled={!Number(value)} onClick={() => onSubmit({ value: Number(value) })} />
    </div>
  );
}

function SidesInput({ target, saving, onSubmit }: { target: number; saving: boolean; onSubmit(r: StepResult): void }) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].player;
  const [left, setLeft] = useState(String(target));
  const [right, setRight] = useState(String(target));
  return (
    <div className={styles.inputs}>
      <div className={styles.sides}>
        <Stepper value={left} onChange={setLeft} label={text.left} testId="player-left" />
        <Stepper value={right} onChange={setRight} label={text.right} testId="player-right" />
      </div>
      <DoneButton
        saving={saving}
        disabled={!Number(left) && !Number(right)}
        onClick={() => onSubmit({ left: Number(left || 0), right: Number(right || 0) })}
      />
    </div>
  );
}

function DistanceInput({ target, saving, onSubmit }: { target: number; saving: boolean; onSubmit(r: StepResult): void }) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].player;
  const [meters, setMeters] = useState(String(target));
  const [time, setTime] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <div className={styles.inputs}>
      <div className={styles.stepper}>
        <div className={styles.inputLabel}>{text.meters}</div>
        <input
          inputMode="numeric"
          className={styles.bigInput}
          value={meters}
          onChange={(e) => setMeters(digitsOnly(e.target.value, 300000))}
          aria-label={text.meters}
          data-testid="player-meters"
        />
      </div>
      <label className={styles.timeField}>
        <span className={styles.inputLabel}>{text.time}</span>
        <input
          inputMode="numeric"
          className={styles.timeInput}
          value={time}
          placeholder="25:30"
          onChange={(e) => setTime(formatDurationTyping(e.target.value))}
          data-testid="player-time"
        />
      </label>
      {error ? <p className={styles.error}>{error}</p> : null}
      <DoneButton
        saving={saving}
        onClick={() => {
          const m = Number(meters || 0);
          if (m < 10) {
            setError(text.invalidDistance);
            return;
          }
          const parsed = parseDurationInput(time);
          if (!parsed.ok) {
            setError(text.invalidTime);
            return;
          }
          setError(null);
          onSubmit({ value: m, seconds: parsed.value });
        }}
      />
    </div>
  );
}

/**
 * Удержание (планка, стульчик, боковая планка): обратный отсчёт цели; у «на сторону» — сначала
 * левая, потом правая. В ноль сторона записывается сама; «Готово» — записать сколько простоял.
 */
function HoldInput({
  step,
  saving,
  onSubmit,
  onRunning,
  beep,
  voice,
  prime,
}: {
  step: PlayerStep;
  saving: boolean;
  onSubmit(r: StepResult): void;
  onRunning(running: boolean): void;
  beep(): void;
  voice(kind: 'prepare' | 'start'): void;
  prime(): Promise<void>;
}) {
  const { locale } = useI18n();
  const text = circuitsMessages[locale].player;
  const target = Math.max(1, step.target ?? 1);
  const sides = step.perSide ? 2 : 1;
  const [side, setSide] = useState(0);
  const [left, setLeft] = useState(target);
  const [running, setRunning] = useState(false);
  const [recorded, setRecorded] = useState<number[]>([]);
  const leftRef = useRef(target);
  const submittedRef = useRef(false);

  useEffect(() => onRunning(running), [running, onRunning]);
  useEffect(() => () => onRunning(false), [onRunning]);

  const record = useCallback(
    (value: number) => {
      const next = [...recorded, value];
      setRunning(false);
      if (next.length < sides) {
        setRecorded(next);
        setSide((s) => s + 1);
        leftRef.current = target;
        setLeft(target);
        return;
      }
      if (submittedRef.current) return;
      submittedRef.current = true;
      setRecorded(next);
      onSubmit(sides === 2 ? { left: next[0], right: next[1] } : { value: next[0] });
    },
    [onSubmit, recorded, sides, target],
  );
  const recordRef = useRef(record);
  useEffect(() => {
    recordRef.current = record;
  }, [record]);

  // Тик отсчёта: сигнал на 3-2-1, в ноль — «старт», вибрация и запись стороны/подхода.
  useEffect(() => {
    if (!running || saving) return;
    const id = window.setInterval(() => {
      const next = Math.max(0, leftRef.current - 1);
      leftRef.current = next;
      setLeft(next);
      if (next > 0 && next <= 3) beep();
      if (next === 0) {
        window.clearInterval(id);
        voice('start');
        vibrate();
        recordRef.current(target);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [running, saving, beep, voice, target]);

  // Повторная попытка после ошибки записи: снова можно нажать «Готово».
  useEffect(() => {
    if (!saving) submittedRef.current = false;
  }, [saving]);

  const elapsed = target - left;
  const sideName = sides === 2 ? (side === 0 ? text.left : text.right) : null;

  return (
    <div className={styles.inputs}>
      {sideName ? <div className={styles.sideName}>{text.holdSide(sideName)}</div> : null}
      <div className={styles.inputLabel}>{text.holdLeft}</div>
      <div className={`${styles.clock} ${running && left <= 3 ? styles.clockDanger : ''}`} data-testid="player-hold">
        {formatDuration(left)}
      </div>
      <div className={styles.pmRow}>
        <button
          type="button"
          className={styles.minus}
          onClick={async () => {
            await prime();
            setRunning((r) => !r);
          }}
          disabled={saving}
        >
          {running ? text.holdPause : text.holdStart}
        </button>
        <button
          type="button"
          className={styles.plus}
          onClick={() => record(elapsed)}
          disabled={saving || elapsed <= 0}
          data-testid="player-done"
        >
          {saving ? text.saving : text.done}
        </button>
      </div>
      {recorded.length && sides === 2 ? (
        <div className={styles.meta}>
          {text.left}: {formatExerciseValue(recorded[0], step.exerciseType, true, locale)}
        </div>
      ) : null}
    </div>
  );
}
