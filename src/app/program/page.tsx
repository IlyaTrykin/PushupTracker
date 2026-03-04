'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

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
  startedAt: string | null;
  completed: boolean;
  completedAt: string | null;
  isFinalTest?: boolean;
  sets: TrainingSet[];
};

type ProgramStats = {
  totalSessions: number;
  completedSessions: number;
  totalSets: number;
  completedSets: number;
  successWeeks: number;
  completionPercent: number;
  nextSession: TrainingSession | null;
};

type ProgramDetail = {
  id: string;
  exerciseType: string;
  goalType: string;
  targetReps: number | null;
  durationWeeks: number;
  frequencyPerWeek: number;
  baselineMaxReps: number;
  ageYears: number;
  weightKg: number;
  sex: string;
  status: string;
  needsRetest: boolean;
  isActive: boolean;
  sessions: TrainingSession[];
  stats: ProgramStats;
  warnings: string[];
};

type ProgramHistoryRow = {
  id: string;
  exerciseType: string;
  goalType: string;
  status: string;
  createdAt: string;
  startedAt: string;
  finishedAt: string | null;
  durationWeeks: number;
  frequencyPerWeek: number;
  baselineMaxReps: number;
  targetReps: number | null;
  totalSessions: number;
  completedSessions: number;
  completionPercent: number;
};

type ProgramProfileHints = {
  ageYears: number | null;
  weightKg: number | null;
  sex: string | null;
};

type ProgramOverview = {
  profileHints: ProgramProfileHints;
  activePrograms: ProgramDetail[];
  history: ProgramHistoryRow[];
};

type CreateForm = {
  exerciseType: 'pushups' | 'pullups' | 'crunches' | 'squats';
  baselineMaxReps: number;
  targetReps: number;
  frequencyPerWeek: number;
  durationWeeks: number;
  ageYears: number;
  weightKg: number;
  sex: 'male' | 'female' | 'other' | 'unknown';
};

type CreateNumericField =
  | 'baselineMaxReps'
  | 'targetReps'
  | 'frequencyPerWeek'
  | 'durationWeeks'
  | 'ageYears'
  | 'weightKg';

function parseDraftNumber(raw: string | undefined, fallback: number): number {
  if (raw == null) return fallback;
  const trimmed = raw.trim();
  if (!trimmed) return 0;
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

async function fetchJson(url: string, init?: RequestInit) {
  const res = await fetch(url, { ...init, credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {}
  }
  if (!res.ok) throw new Error(data?.error || `Ошибка (код ${res.status})`);
  return data;
}

function exerciseLabel(exerciseType: string) {
  if (exerciseType === 'pushups') return 'Отжимания';
  if (exerciseType === 'pullups') return 'Подтягивания';
  if (exerciseType === 'crunches') return 'Скручивания';
  if (exerciseType === 'squats') return 'Приседания';
  return exerciseType;
}

function exerciseCode(exerciseType: string) {
  if (exerciseType === 'pushups') return 'ОТЖ';
  if (exerciseType === 'pullups') return 'ПТГ';
  if (exerciseType === 'crunches') return 'СКР';
  if (exerciseType === 'squats') return 'ПРС';
  return exerciseType.toUpperCase().slice(0, 3);
}

function exerciseColor(exerciseType: string) {
  if (exerciseType === 'pushups') return '#dbeafe';
  if (exerciseType === 'pullups') return '#fee2e2';
  if (exerciseType === 'crunches') return '#dcfce7';
  if (exerciseType === 'squats') return '#fef3c7';
  return '#e5e7eb';
}

function exerciseLegendColor(exerciseType: string) {
  if (exerciseType === 'pushups') return '#38bdf8';
  if (exerciseType === 'pullups') return '#ef4444';
  if (exerciseType === 'crunches') return '#22c55e';
  if (exerciseType === 'squats') return '#b8860b';
  return '#9ca3af';
}

function exerciseFeedIcon(exerciseType: string) {
  const v = '20260304-4';
  if (exerciseType === 'pullups') return `/icons/exercise-types/feed/pullups.svg?v=${v}`;
  if (exerciseType === 'crunches') return `/icons/exercise-types/feed/crunches.svg?v=${v}`;
  if (exerciseType === 'squats') return `/icons/exercise-types/feed/squats.svg?v=${v}`;
  return `/icons/exercise-types/feed/pushups.svg?v=${v}`;
}

const EXERCISE_ORDER = ['pushups', 'pullups', 'crunches', 'squats'] as const;

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

function dayKeyFromIso(iso: string) {
  const d = toDate(iso);
  if (!d) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthStart(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addCalendarMonths(d: Date, delta: number) {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function formatMonthTitle(d: Date) {
  const raw = d.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatSessionDateTime(iso: string) {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSessionDate(iso: string) {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDayTitle(dayKey: string) {
  const d = toDate(`${dayKey}T00:00:00`);
  if (!d) return dayKey;
  return d.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function renderSessionSetPlan(session: TrainingSession) {
  return session.sets
    .slice()
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((set) => (set.isKeySet && !session.isFinalTest ? 'max' : String(set.targetReps)))
    .join('-');
}

function calendarDayBackground(upcoming: number, completed: number) {
  if (upcoming > 0 && completed > 0) {
    return 'linear-gradient(135deg, #bbf7d0 0%, #bbf7d0 48%, #fef08a 52%, #fef08a 100%)';
  }
  if (upcoming > 0) return '#fef08a';
  if (completed > 0) return '#bbf7d0';
  return '#fff';
}

function suggestedFrequencyPerWeek(args: {
  exerciseType: 'pushups' | 'pullups' | 'crunches' | 'squats';
  baselineMaxReps: number;
  targetReps: number;
  ageYears: number;
  weightKg: number;
}) {
  const baseline = Math.max(1, Math.round(args.baselineMaxReps));
  const target = Math.max(baseline, Math.round(args.targetReps));
  const age = Math.max(12, Math.min(90, Math.round(args.ageYears)));
  const weight = Math.max(30, Math.min(250, Math.round(args.weightKg)));
  const gap = Math.max(0, target - baseline);

  let freq = 3;
  if (baseline <= 8) freq = 2;
  if (baseline >= 32) freq = 4;
  if (args.exerciseType === 'pullups') freq -= 1;
  if (age >= 45) freq -= 1;
  if (age >= 60) freq -= 1;
  if (weight >= 110 && (args.exerciseType === 'pushups' || args.exerciseType === 'pullups')) freq -= 1;
  if (gap >= Math.max(12, Math.round(baseline * 0.7))) freq += 1;

  return Math.max(2, Math.min(6, Math.round(freq)));
}

function suggestedDurationWeeks(args: {
  exerciseType: 'pushups' | 'pullups' | 'crunches' | 'squats';
  baselineMaxReps: number;
  targetReps: number;
  ageYears: number;
  weightKg: number;
  frequencyPerWeek: number;
}) {
  const baseline = Math.max(1, Math.round(args.baselineMaxReps));
  const target = Math.max(baseline, Math.round(args.targetReps));
  const age = Math.max(12, Math.min(90, Math.round(args.ageYears)));
  const weight = Math.max(30, Math.min(250, Math.round(args.weightKg)));
  const frequency = Math.max(1, Math.min(6, Math.round(args.frequencyPerWeek)));

  const coefs: Record<string, number> = {
    pushups: 1,
    pullups: 0.85,
    crunches: 1.1,
    squats: 1.05,
  };

  const coef = coefs[args.exerciseType] ?? 1;
  const gap = Math.max(0, target - baseline);
  let readiness = 1;
  if (baseline <= 8) readiness *= 0.8;
  if (baseline >= 40) readiness *= 1.1;
  if (age >= 40) readiness *= 0.9;
  if (age >= 55) readiness *= 0.8;
  if (weight >= 95 && (args.exerciseType === 'pushups' || args.exerciseType === 'pullups')) readiness *= 0.92;
  if (weight >= 115 && (args.exerciseType === 'pushups' || args.exerciseType === 'pullups')) readiness *= 0.88;
  if (args.exerciseType === 'pullups') readiness *= 0.88;

  const progressPerSession = Math.max(0.35, baseline * 0.05 * coef * readiness);
  const requiredSessions = Math.ceil(gap / progressPerSession) + frequency * 2;

  let weeks = Math.ceil(requiredSessions / frequency);
  if (age >= 55) weeks += 1;
  if (frequency >= 5) weeks += 1;

  return Math.max(4, Math.min(24, Math.round(weeks)));
}

export default function ProgramPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [activePrograms, setActivePrograms] = useState<ProgramDetail[]>([]);
  const [history, setHistory] = useState<ProgramHistoryRow[]>([]);
  const [profileHints, setProfileHints] = useState<ProgramProfileHints>({ ageYears: null, weightKg: null, sex: null });

  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [frequencyManual, setFrequencyManual] = useState(false);
  const [durationManual, setDurationManual] = useState(false);
  const [formDrafts, setFormDrafts] = useState<Partial<Record<CreateNumericField, string>>>({});
  const [calendarMonth, setCalendarMonth] = useState<Date>(() => monthStart(new Date()));
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);

  const [form, setForm] = useState<CreateForm>({
    exerciseType: 'pushups',
    baselineMaxReps: 20,
    targetReps: 50,
    frequencyPerWeek: 3,
    durationWeeks: 8,
    ageYears: 30,
    weightKg: 75,
    sex: 'unknown',
  });

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = (await fetchJson('/api/program')) as ProgramOverview;
      setActivePrograms(Array.isArray(data.activePrograms) ? data.activePrograms : []);
      setHistory(Array.isArray(data.history) ? data.history : []);
      setProfileHints(data.profileHints || { ageYears: null, weightKg: null, sex: null });

      setForm((prev) => ({
        ...prev,
        ageYears: data.profileHints?.ageYears ?? prev.ageYears,
        weightKg: data.profileHints?.weightKg ?? prev.weightKg,
        sex: (data.profileHints?.sex as any) || prev.sex,
      }));
    } catch (e: any) {
      setError(e?.message || 'Не удалось загрузить программу');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolvedForm = useMemo(() => ({
    ...form,
    baselineMaxReps: parseDraftNumber(formDrafts.baselineMaxReps, form.baselineMaxReps),
    targetReps: parseDraftNumber(formDrafts.targetReps, form.targetReps),
    frequencyPerWeek: parseDraftNumber(formDrafts.frequencyPerWeek, form.frequencyPerWeek),
    durationWeeks: parseDraftNumber(formDrafts.durationWeeks, form.durationWeeks),
    ageYears: parseDraftNumber(formDrafts.ageYears, form.ageYears),
    weightKg: parseDraftNumber(formDrafts.weightKg, form.weightKg),
  }), [form, formDrafts]);

  const numericInputValue = (field: CreateNumericField) => formDrafts[field] ?? String(form[field]);

  const setNumericField = (field: CreateNumericField, raw: string) => {
    setFormDrafts((prev) => ({ ...prev, [field]: raw }));
    const trimmed = raw.trim();
    if (!trimmed) return;
    const n = Number(trimmed);
    if (!Number.isFinite(n)) return;
    const rounded = Math.round(n);
    setForm((prev) => ({ ...prev, [field]: rounded }));
  };

  const applyNumericField = (field: CreateNumericField, value: number) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setFormDrafts((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const recommendedFrequency = useMemo(() => {
    return suggestedFrequencyPerWeek({
      exerciseType: resolvedForm.exerciseType,
      baselineMaxReps: resolvedForm.baselineMaxReps,
      targetReps: resolvedForm.targetReps,
      ageYears: resolvedForm.ageYears,
      weightKg: resolvedForm.weightKg,
    });
  }, [resolvedForm.exerciseType, resolvedForm.baselineMaxReps, resolvedForm.targetReps, resolvedForm.ageYears, resolvedForm.weightKg]);

  const recommendedDuration = useMemo(() => {
    return suggestedDurationWeeks({
      exerciseType: resolvedForm.exerciseType,
      baselineMaxReps: resolvedForm.baselineMaxReps,
      targetReps: resolvedForm.targetReps,
      ageYears: resolvedForm.ageYears,
      weightKg: resolvedForm.weightKg,
      frequencyPerWeek: resolvedForm.frequencyPerWeek,
    });
  }, [resolvedForm.exerciseType, resolvedForm.baselineMaxReps, resolvedForm.targetReps, resolvedForm.ageYears, resolvedForm.weightKg, resolvedForm.frequencyPerWeek]);

  useEffect(() => {
    if (frequencyManual) return;
    setForm((prev) => (
      prev.frequencyPerWeek === recommendedFrequency
        ? prev
        : { ...prev, frequencyPerWeek: recommendedFrequency }
    ));
  }, [recommendedFrequency, frequencyManual]);

  useEffect(() => {
    if (durationManual) return;
    setForm((prev) => (
      prev.durationWeeks === recommendedDuration
        ? prev
        : { ...prev, durationWeeks: recommendedDuration }
    ));
  }, [recommendedDuration, durationManual]);

  const canNextStep = useMemo(() => {
    if (step === 1) return Boolean(form.exerciseType);
    if (step === 2) return Number.isFinite(resolvedForm.baselineMaxReps) && resolvedForm.baselineMaxReps > 0;
    if (step === 3) {
      return (
        Number.isFinite(resolvedForm.targetReps) &&
        resolvedForm.targetReps > 0 &&
        resolvedForm.targetReps >= resolvedForm.baselineMaxReps
      );
    }
    if (step === 4) {
      return (
        resolvedForm.frequencyPerWeek >= 1 &&
        resolvedForm.frequencyPerWeek <= 6 &&
        resolvedForm.durationWeeks >= 4 &&
        resolvedForm.durationWeeks <= 24 &&
        resolvedForm.ageYears >= 12 &&
        resolvedForm.ageYears <= 90 &&
        resolvedForm.weightKg >= 30 &&
        resolvedForm.weightKg <= 250
      );
    }
    return false;
  }, [form.exerciseType, resolvedForm, step]);

  const beginCreate = () => {
    const nextFreq = recommendedFrequency;
    const nextDuration = suggestedDurationWeeks({
      exerciseType: resolvedForm.exerciseType,
      baselineMaxReps: resolvedForm.baselineMaxReps,
      targetReps: resolvedForm.targetReps,
      ageYears: resolvedForm.ageYears,
      weightKg: resolvedForm.weightKg,
      frequencyPerWeek: nextFreq,
    });
    setShowCreate(true);
    setStep(1);
    setInfo(null);
    setError(null);
    setFrequencyManual(false);
    setDurationManual(false);
    setFormDrafts({});
    setForm((prev) => ({ ...prev, frequencyPerWeek: nextFreq, durationWeeks: nextDuration }));
  };

  const cancelCreate = () => {
    setShowCreate(false);
    setStep(1);
    setFormDrafts({});
  };

  const submitCreate = async () => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fetchJson('/api/program', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exerciseType: form.exerciseType,
          baselineMaxReps: resolvedForm.baselineMaxReps,
          targetReps: resolvedForm.targetReps,
          frequencyPerWeek: resolvedForm.frequencyPerWeek,
          durationWeeks: resolvedForm.durationWeeks,
          ageYears: resolvedForm.ageYears,
          weightKg: resolvedForm.weightKg,
          sex: form.sex,
        }),
      });

      setShowCreate(false);
      setFormDrafts({});
      setInfo('Программа создана');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать программу');
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async (programId: string) => {
    const ok = window.confirm('Прервать эту программу?');
    if (!ok) return;

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fetchJson(`/api/program/${programId}/deactivate`, { method: 'POST' });
      setInfo('Программа прервана');
      await load();
    } catch (e: any) {
      setError(e?.message || 'Не удалось деактивировать программу');
    } finally {
      setBusy(false);
    }
  };

  const sessionRows = useMemo(() => {
    const out: Array<TrainingSession & { exerciseType: string; programId: string }> = [];
    activePrograms.forEach((program) => {
      program.sessions.forEach((session) => out.push({
        ...session,
        exerciseType: program.exerciseType,
        programId: program.id,
      }));
    });
    return out.sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
  }, [activePrograms]);

  const nextSession = useMemo(
    () => sessionRows.find((x) => !x.completed) ?? null,
    [sessionRows],
  );

  useEffect(() => {
    const next = sessionRows.find((x) => !x.completed)?.scheduledAt || sessionRows[0]?.scheduledAt;
    if (!next) {
      setCalendarMonth(monthStart(new Date()));
      return;
    }
    const d = toDate(next);
    setCalendarMonth(monthStart(d || new Date()));
  }, [sessionRows]);

  const sessionsByDay = useMemo(() => {
    const map = new Map<string, { upcoming: number; completed: number; sessions: Array<TrainingSession & { exerciseType: string; programId: string }> }>();
    sessionRows.forEach((session) => {
      const key = dayKeyFromIso(session.scheduledAt);
      if (!key) return;
      const row = map.get(key) || { upcoming: 0, completed: 0, sessions: [] };
      if (session.completed) row.completed += 1;
      else row.upcoming += 1;
      row.sessions.push(session);
      map.set(key, row);
    });
    return map;
  }, [sessionRows]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (first.getDay() + 6) % 7;
    const out: Array<{ key: string; day: number; upcoming: number; completed: number } | null> = [];
    for (let i = 0; i < mondayOffset; i += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = new Date(year, month, day);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const row = sessionsByDay.get(key);
      out.push({ key, day, upcoming: row?.upcoming || 0, completed: row?.completed || 0 });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [calendarMonth, sessionsByDay]);

  const calendarWeekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const todayKey = dayKeyFromIso(new Date().toISOString());
  const selectedDaySessions = selectedDayKey
    ? (sessionsByDay.get(selectedDayKey)?.sessions || []).filter((session) => !session.completed)
    : [];

  return (
    <div className="app-page" style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={btnPrimary} onClick={beginCreate}>
          Новая программа тренировок
        </button>
      </div>

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {info ? <p style={{ color: '#16a34a' }}>{info}</p> : null}
      {loading ? <p>Загрузка…</p> : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Следующая тренировка</h2>
          {activePrograms.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Активных программ нет. Когда будете готовы, начните новую программу.</div>
          ) : !nextSession ? (
            <div style={{ color: '#6b7280' }}>Предстоящих тренировок не найдено.</div>
          ) : (
            <div style={{ ...programCard, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{ ...nextExerciseDot, background: exerciseLegendColor(nextSession.exerciseType) }}
                      title={exerciseLabel(nextSession.exerciseType)}
                    />
                    <span style={{ fontWeight: 900 }}>{renderSessionSetPlan(nextSession)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#374151' }}>
                    {formatSessionDate(nextSession.scheduledAt)}
                  </div>
                </div>
                <Link href={`/program/session/${nextSession.id}`} style={{ ...btnPrimaryLink, padding: '8px 10px' }}>
                  Приступить
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Календарь программ</h2>
          {sessionRows.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Пока нет запланированных тренировок.</div>
          ) : (
            <div style={calendarWrap}>
              <div style={calendarNavWrap}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: 'center' }}>{formatMonthTitle(calendarMonth)}</div>
                <div style={calendarNavButtons}>
                  <button type="button" style={btnSecondary} onClick={() => setCalendarMonth((d) => addCalendarMonths(d, -1))}>
                    Предыдущий
                  </button>
                  <button type="button" style={btnSecondary} onClick={() => setCalendarMonth((d) => addCalendarMonths(d, 1))}>
                    Следующий
                  </button>
                </div>
              </div>

              <div style={calendarGrid}>
                {calendarWeekdays.map((day) => (
                  <div key={day} style={calendarWeekdayCell}>{day}</div>
                ))}
                {calendarCells.map((cell, idx) => {
                  if (!cell) return <div key={`empty-${idx}`} style={calendarEmptyCell} />;
                  const row = sessionsByDay.get(cell.key);
                  const isToday = cell.key === todayKey;
                  const cellDate = new Date(`${cell.key}T00:00:00`);
                  const dayOfWeek = cellDate.getDay();
                  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                  const baseBackground = calendarDayBackground(cell.upcoming, cell.completed);
                  const presentTypes = new Set((row?.sessions || []).map((s) => s.exerciseType));
                  const exerciseTypes = EXERCISE_ORDER.filter((type) => presentTypes.has(type));
                  const hasSessions = Boolean(row?.upcoming);
                  const dayStyle: React.CSSProperties = {
                    ...calendarDayCell,
                    background: isWeekend
                      ? `linear-gradient(rgba(244, 114, 182, 0.12), rgba(244, 114, 182, 0.12)), ${baseBackground}`
                      : baseBackground,
                    borderColor: isToday ? '#16a34a' : cell.upcoming || cell.completed ? '#d1d5db' : '#f3f4f6',
                    boxShadow: isToday ? 'inset 0 0 0 1px #16a34a' : 'none',
                  };
                  const dayContent = (
                    <>
                      <div style={{ fontWeight: 900, color: '#000' }}>{cell.day}</div>
                      {exerciseTypes.length ? (
                        <div style={{ display: 'flex', gap: 'clamp(4px, 0.5vw, 8px)', flexWrap: 'wrap', marginLeft: -1 }}>
                          {exerciseTypes.map((exerciseType) => (
                            <img
                              key={exerciseType}
                              src={exerciseFeedIcon(exerciseType)}
                              alt={exerciseLabel(exerciseType)}
                              style={calendarExerciseIcon}
                              title={exerciseLabel(exerciseType)}
                            />
                          ))}
                        </div>
                      ) : null}
                    </>
                  );

                  if (hasSessions) {
                    return (
                      <button
                        type="button"
                        key={cell.key}
                        onClick={() => setSelectedDayKey(cell.key)}
                        style={{ ...calendarDayButton, ...dayStyle }}
                        title="Открыть тренировки этого дня"
                      >
                        {dayContent}
                      </button>
                    );
                  }

                  return (
                    <div
                      key={cell.key}
                      style={dayStyle}
                    >
                      {dayContent}
                    </div>
                  );
                })}
              </div>

              <div style={calendarLegendWrap}>
                {EXERCISE_ORDER.map((exerciseType) => (
                  <div key={exerciseType} style={calendarLegendItem}>
                    <img src={exerciseFeedIcon(exerciseType)} alt={exerciseLabel(exerciseType)} style={calendarLegendIcon} />
                    <span>{exerciseLabel(exerciseType)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Активные программы</h2>
          {activePrograms.length === 0 ? (
            <div style={{ color: '#6b7280' }}>Активных программ пока нет.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {activePrograms.map((program) => (
                <div key={program.id} style={programCard}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span
                          style={{ ...exercisePictogram, background: exerciseColor(program.exerciseType) }}
                          title={exerciseLabel(program.exerciseType)}
                        >
                          {exerciseCode(program.exerciseType)}
                        </span>
                        <div style={{ fontWeight: 900, fontSize: 18 }}>
                          {exerciseLabel(program.exerciseType)}
                        </div>
                      </div>
                      <div style={{ marginTop: 4, color: '#111827' }}>
                        База: <b>{program.baselineMaxReps}</b> · Цель: <b>{program.targetReps}</b> · Длительность: <b>{program.durationWeeks}</b> нед
                      </div>
                      <div style={{ marginTop: 4, color: '#111827' }}>
                        Темп: <b>{program.frequencyPerWeek}</b>/нед · Прогресс: <b>{program.stats.completionPercent}%</b>
                      </div>
                      {program.stats.nextSession ? (
                        <div style={{ marginTop: 4, color: '#111827' }}>
                          Ближайшая: <b>{formatSessionDateTime(program.stats.nextSession.scheduledAt)}</b>
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link href={`/program/${program.id}`} style={btnLink}>
                        Открыть программу
                      </Link>
                      <button
                        type="button"
                        style={btnDanger}
                        onClick={() => handleDeactivate(program.id)}
                        disabled={busy}
                      >
                        Прервать
                      </button>
                    </div>
                  </div>
                  {program.warnings?.length ? (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, border: '1px solid #f59e0b', background: '#fffbeb' }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>Внимание</div>
                      {program.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 14, marginTop: i ? 4 : 0 }}>{w}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>История программ</h2>
          {history.length === 0 ? (
            <div>Пока нет завершённых или отключённых программ.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {history.map((row) => (
                <div key={row.id} style={historyCard}>
                  <div style={{ fontWeight: 900 }}>
                    {exerciseLabel(row.exerciseType)} · цель: {row.targetReps ?? '—'}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>
                    {new Date(row.createdAt).toLocaleDateString('ru-RU')} · статус: {row.status}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>
                    Начато: {new Date(row.startedAt).toLocaleDateString('ru-RU')}
                    {' · '}
                    Завершено: {row.finishedAt ? new Date(row.finishedAt).toLocaleDateString('ru-RU') : '—'}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    Выполнено: {row.completedSessions}/{row.totalSessions} ({row.completionPercent}%)
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {selectedDayKey ? (
        <div style={modalBackdrop} onClick={() => setSelectedDayKey(null)}>
          <section style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <h2 style={{ marginTop: 0, marginBottom: 0 }}>{formatDayTitle(selectedDayKey)}</h2>
              <button type="button" style={btnSecondary} onClick={() => setSelectedDayKey(null)}>Закрыть</button>
            </div>
            <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
              {selectedDaySessions.length === 0 ? (
                <div style={{ color: '#6b7280' }}>На эту дату нет запланированных тренировок.</div>
              ) : null}
              {selectedDaySessions
                .slice()
                .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime())
                .map((session) => (
                  <div key={session.id} style={programCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                          <span
                            style={{ ...exercisePictogram, background: exerciseColor(session.exerciseType) }}
                            title={exerciseLabel(session.exerciseType)}
                          >
                            {exerciseCode(session.exerciseType)}
                          </span>
                          <span style={{ fontWeight: 900 }}>{exerciseLabel(session.exerciseType)}</span>
                        </div>
                        <div style={{ marginTop: 4, color: '#111827' }}>
                          {formatSessionDateTime(session.scheduledAt)} · тренировка #{session.sessionNumber}
                          {session.isFinalTest ? ' · финальный тест' : ''}
                        </div>
                        <div style={{ marginTop: 4, color: '#111827' }}>
                          План: <b>{renderSessionSetPlan(session)}</b>
                        </div>
                      </div>
                      {session.completed ? (
                        <span style={doneBadge}>Выполнено</span>
                      ) : (
                        <Link href={`/program/session/${session.id}`} style={btnPrimaryLink}>
                          Приступить
                        </Link>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>
      ) : null}

      {showCreate ? (
        <div style={modalBackdrop} onClick={cancelCreate}>
          <section style={modalCard} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0 }}>Новая программа тренировок</h2>
            <div style={{ marginBottom: 10, color: '#4b5563' }}>Шаг {step} из 4</div>

            {step === 1 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <label>1) Выберите упражнение</label>
                <select
                  value={form.exerciseType}
                  onChange={(e) => setForm((f) => ({ ...f, exerciseType: e.target.value as any }))}
                  style={inputStyle}
                >
                  <option value="pushups">Отжимания</option>
                  <option value="pullups">Подтягивания</option>
                  <option value="crunches">Скручивания</option>
                  <option value="squats">Приседания</option>
                </select>
              </div>
            ) : null}

            {step === 2 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <label>2) Базовый тест (AMRAP)</label>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={numericInputValue('baselineMaxReps')}
                  onChange={(e) => setNumericField('baselineMaxReps', e.target.value)}
                  style={inputStyle}
                />
              </div>
            ) : null}

            {step === 3 ? (
              <div style={{ display: 'grid', gap: 8 }}>
                <label>3) Целевое значение повторений в одном подходе</label>
                <input
                  type="number"
                  min={Math.max(1, resolvedForm.baselineMaxReps)}
                  max={1000}
                  value={numericInputValue('targetReps')}
                  onChange={(e) => setNumericField('targetReps', e.target.value)}
                  style={inputStyle}
                />
              </div>
            ) : null}

            {step === 4 ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <label>4) Настройки плана</label>

                <div style={grid2}>
                  <div>
                    <div style={{ marginBottom: 4 }}>Темп тренировок (в неделю)</div>
                    <input
                      type="number"
                      min={1}
                      max={6}
                      value={numericInputValue('frequencyPerWeek')}
                      onChange={(e) => {
                        setFrequencyManual(true);
                        setNumericField('frequencyPerWeek', e.target.value);
                      }}
                      style={inputStyle}
                    />
                    <div style={hint}>Рекомендовано: {recommendedFrequency}/нед</div>
                    {form.frequencyPerWeek !== recommendedFrequency ? (
                      <button
                        type="button"
                        style={{ ...btnText, marginTop: 4 }}
                        onClick={() => {
                          setFrequencyManual(false);
                          applyNumericField('frequencyPerWeek', recommendedFrequency);
                        }}
                      >
                        Вернуть рекомендованный темп
                      </button>
                    ) : null}
                  </div>

                  <div>
                    <div style={{ marginBottom: 4 }}>Длительность программы (недели)</div>
                    <input
                      type="number"
                      min={4}
                      max={24}
                      value={numericInputValue('durationWeeks')}
                      onChange={(e) => {
                        setDurationManual(true);
                        setNumericField('durationWeeks', e.target.value);
                      }}
                      style={inputStyle}
                    />
                    <div style={hint}>Рекомендовано: {recommendedDuration} недель</div>
                    {form.durationWeeks !== recommendedDuration ? (
                      <button
                        type="button"
                        style={{ ...btnText, marginTop: 4 }}
                        onClick={() => {
                          setDurationManual(false);
                          applyNumericField('durationWeeks', recommendedDuration);
                        }}
                      >
                        Вернуть рекомендованную длительность
                      </button>
                    ) : null}
                  </div>
                </div>

                <div style={grid2}>
                  <div>
                    <div style={{ marginBottom: 4 }}>Возраст</div>
                    <input
                      type="number"
                      min={12}
                      max={90}
                      value={numericInputValue('ageYears')}
                      disabled={profileHints.ageYears != null}
                      onChange={(e) => setNumericField('ageYears', e.target.value)}
                      style={{ ...inputStyle, opacity: profileHints.ageYears != null ? 0.7 : 1 }}
                    />
                    {profileHints.ageYears != null ? <div style={hint}>Подставлено из профиля</div> : null}
                  </div>

                  <div>
                    <div style={{ marginBottom: 4 }}>Вес (кг)</div>
                    <input
                      type="number"
                      min={30}
                      max={250}
                      value={numericInputValue('weightKg')}
                      disabled={profileHints.weightKg != null}
                      onChange={(e) => setNumericField('weightKg', e.target.value)}
                      style={{ ...inputStyle, opacity: profileHints.weightKg != null ? 0.7 : 1 }}
                    />
                    {profileHints.weightKg != null ? <div style={hint}>Подставлено из профиля</div> : null}
                  </div>
                </div>
              </div>
            ) : null}

            <div style={{ marginTop: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" style={btnSecondary} onClick={cancelCreate} disabled={busy}>Отмена</button>
              {step > 1 ? (
                <button type="button" style={btnSecondary} onClick={() => setStep((s) => s - 1)} disabled={busy}>Назад</button>
              ) : null}
              {step < 4 ? (
                <button type="button" style={btnPrimary} onClick={() => setStep((s) => s + 1)} disabled={!canNextStep || busy}>Далее</button>
              ) : (
                <button type="button" style={btnPrimary} onClick={submitCreate} disabled={!canNextStep || busy}>
                  Сгенерировать программу
                </button>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
};

const historyCard: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
  padding: 10,
};

const programCard: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
  padding: 10,
};

const exercisePictogram: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 34,
  height: 22,
  borderRadius: 999,
  border: '1px solid #d1d5db',
  fontSize: 11,
  fontWeight: 900,
  color: '#111827',
  padding: '0 7px',
};

const grid2: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  padding: '8px 10px',
  background: '#fff',
};

const hint: React.CSSProperties = {
  fontSize: 12,
  color: '#6b7280',
  marginTop: 4,
};

const btnPrimary: React.CSSProperties = {
  border: 'none',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 900,
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
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#fff',
  color: '#111827',
  fontWeight: 800,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const btnPrimaryLink: React.CSSProperties = {
  border: 'none',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 900,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const btnDanger: React.CSSProperties = {
  border: '1px solid #dc2626',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#fff',
  color: '#dc2626',
  fontWeight: 900,
  cursor: 'pointer',
};

const btnText: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  color: '#2563eb',
  cursor: 'pointer',
  fontWeight: 800,
  padding: 0,
};

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(17, 24, 39, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 14,
  zIndex: 50,
};

const modalCard: React.CSSProperties = {
  width: 'min(680px, 100%)',
  maxHeight: '88vh',
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
};

const calendarWrap: React.CSSProperties = {
  display: 'grid',
  gap: 10,
};

const calendarNavWrap: React.CSSProperties = {
  display: 'grid',
  gap: 8,
};

const calendarNavButtons: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 8,
};

const calendarGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
  gap: 6,
};

const calendarWeekdayCell: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 800,
  color: '#000',
  textAlign: 'center',
  padding: '4px 0',
};

const calendarEmptyCell: React.CSSProperties = {
  minHeight: 90,
  border: '1px dashed #f3f4f6',
  borderRadius: 10,
  background: '#fff',
};

const calendarDayCell: React.CSSProperties = {
  minHeight: 'clamp(90px, 11vw, 126px)',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '8px 8px 8px 4px',
  display: 'grid',
  gap: 4,
  alignContent: 'start',
};

const calendarDayButton: React.CSSProperties = {
  textAlign: 'left',
  cursor: 'pointer',
};

const calendarExerciseIcon: React.CSSProperties = {
  width: 'clamp(14px, 1.25vw, 24px)',
  height: 'clamp(14px, 1.25vw, 24px)',
  objectFit: 'contain',
  flex: '0 0 auto',
  display: 'block',
};

const calendarLegendWrap: React.CSSProperties = {
  marginTop: 10,
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const calendarLegendItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'clamp(6px, 0.4vw, 8px)',
  fontSize: 'clamp(12px, 0.8vw, 14px)',
  fontWeight: 800,
  color: '#000',
};

const calendarLegendIcon: React.CSSProperties = {
  width: 'clamp(14px, 1.25vw, 24px)',
  height: 'clamp(14px, 1.25vw, 24px)',
  objectFit: 'contain',
  flex: '0 0 auto',
  display: 'block',
};

const doneBadge: React.CSSProperties = {
  borderRadius: 999,
  padding: '5px 10px',
  background: '#dcfce7',
  color: '#166534',
  fontWeight: 900,
  fontSize: 12,
};

const nextExerciseDot: React.CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: 999,
  border: '1px solid rgba(0,0,0,0.2)',
  flex: '0 0 auto',
};
