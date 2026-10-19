'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { programHref, programSessionHref } from '@/lib/app-routes';
import { getIntlLocale, t } from '@/i18n/translate';
import { getUserScopedCacheKey, readCachedValue, writeCachedValue } from '@/lib/client-cache';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import {
  PROGRAM_EXERCISE_TYPES,
  programLabel,
  programStartAlternatives,
  suggestDurationWeeks,
  suggestFrequencyPerWeek,
  type DistanceSessionKind,
} from '@/lib/program-plan';
import {
  EXERCISES,
  exerciseIcon,
  exerciseLabel as catalogExerciseLabel,
  isExerciseType as isCatalogExerciseType,
  isUnilateralExercise,
  programKind,
  type ExerciseType as CatalogExerciseType,
  type ProgramKind,
} from '@/lib/exercises';
import { programsMessages } from '@/i18n/messages/features/programs';
import { InfoButton, Sheet } from '@/components/ui';

type TrainingSet = {
  id: string;
  setNumber: number;
  targetReps: number;
  actualReps: number | null;
  restSeconds: number;
  isKeySet: boolean;
  loadKg?: number | null;
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
  sessionKind?: DistanceSessionKind | null;
  sets: TrainingSet[];
};

/** Поля программы, по которым строится её название (`programLabel`). */
type ProgramLabelFields = {
  programType?: string | null;
  loadKg?: number | null;
  circuitPlanId?: string | null;
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

type ProgramDetail = ProgramLabelFields & {
  id: string;
  exerciseType: string;
  nextLoadKg?: number | null;
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

type ProgramHistoryRow = ProgramLabelFields & {
  id: string;
  exerciseType: string;
  nextLoadKg?: number | null;
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
  exerciseType: CatalogExerciseType;
  /** Вес гири гиревой программы. */
  loadKg: number | null;
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
type ExerciseType = CreateForm['exerciseType'];
type JsonObject = Record<string, unknown>;
type ProgramCachePayload = {
  profileHints: ProgramProfileHints;
  activePrograms: ProgramDetail[];
  history: ProgramHistoryRow[];
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isExerciseType(value: string): value is ExerciseType {
  return (EXERCISE_ORDER as readonly string[]).includes(value);
}

function isSex(value: string): value is CreateForm['sex'] {
  return ['male', 'female', 'other', 'unknown'].includes(value);
}

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
  let data: JsonObject | null = null;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
    } catch {}
  }
  if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`);
  return data;
}

function exerciseLabel(exerciseType: string) {
  return catalogExerciseLabel(exerciseType);
}

function exerciseCode(exerciseType: string) {
  return isCatalogExerciseType(exerciseType) ? EXERCISES[exerciseType].code : exerciseType.toUpperCase().slice(0, 3);
}

function exerciseColor(exerciseType: string) {
  return isCatalogExerciseType(exerciseType) ? EXERCISES[exerciseType].colors.soft : '#e5e7eb';
}

function exerciseLegendColor(exerciseType: string) {
  return isCatalogExerciseType(exerciseType) ? EXERCISES[exerciseType].colors.accent : '#9ca3af';
}

function exerciseFeedIcon(exerciseType: string) {
  return exerciseIcon(exerciseType);
}

const EXERCISE_ORDER = PROGRAM_EXERCISE_TYPES;

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

function formatMonthTitle(d: Date, locale: string) {
  const raw = d.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatSessionDateTime(iso: string, locale: string) {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatSessionDate(iso: string, locale: string) {
  const d = toDate(iso);
  if (!d) return '—';
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatDayTitle(dayKey: string, locale: string) {
  const d = toDate(`${dayKey}T00:00:00`);
  if (!d) return dayKey;
  return d.toLocaleDateString(locale, {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function renderSessionSetPlan(session: TrainingSession, exerciseType: string | undefined, locale: string) {
  const distance = programKind(exerciseType) === 'distance';
  return session.sets
    .slice()
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((set) => (set.isKeySet && !session.isFinalTest && !distance ? 'max' : formatExerciseValue(set.targetReps, exerciseType, true, locale)))
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

type SessionRow = TrainingSession & ProgramLabelFields & { exerciseType: string; programId: string };

/** Поля мастера по умолчанию для упражнения: база и цель в его единицах, гиря — эталонная. */
function exerciseDefaults(type: CatalogExerciseType): Pick<CreateForm, 'loadKg' | 'baselineMaxReps' | 'targetReps'> {
  const kind = programKind(type);
  const load = EXERCISES[type].load;
  if (kind === 'distance') return { loadKg: null, baselineMaxReps: 3000, targetReps: 5000 };
  if (kind === 'timed') return { loadKg: null, baselineMaxReps: 30, targetReps: 60 };
  if (kind === 'loaded') return { loadKg: load?.referenceKg ?? null, baselineMaxReps: 10, targetReps: 20 };
  if (type === 'muscle_ups') return { loadKg: null, baselineMaxReps: 1, targetReps: 5 };
  return { loadKg: null, baselineMaxReps: 20, targetReps: 50 };
}

function metersToKmText(meters: number): string {
  return String(Math.round(meters / 10) / 100);
}

function kmTextToMeters(raw: string): number {
  const n = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : 0;
}

function formatKg(kg: number, locale: string): string {
  const text = String(Math.round(kg * 10) / 10);
  return locale === 'en' ? text : text.replace('.', ',');
}

export default function ProgramPage() {
  const { user } = useAuth();
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const text = programsMessages[locale];
  const cacheKey = useMemo(() => getUserScopedCacheKey('program', user?.id, user?.username), [user?.id, user?.username]);
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
  // Дистанция вводится в километрах; в форме — метры.
  const [kmDrafts, setKmDrafts] = useState<{ baseline: string; target: string }>({ baseline: '3', target: '5' });

  const [form, setForm] = useState<CreateForm>({
    exerciseType: 'pushups',
    loadKg: null,
    baselineMaxReps: 20,
    targetReps: 50,
    frequencyPerWeek: 3,
    durationWeeks: 8,
    ageYears: 30,
    weightKg: 75,
    sex: 'unknown',
  });

  const applyPayload = useCallback((payload: ProgramCachePayload) => {
    setActivePrograms(Array.isArray(payload.activePrograms) ? payload.activePrograms : []);
    setHistory(Array.isArray(payload.history) ? payload.history : []);
    setProfileHints(payload.profileHints || { ageYears: null, weightKg: null, sex: null });
    setForm((prev) => ({
      ...prev,
      ageYears: payload.profileHints?.ageYears ?? prev.ageYears,
      weightKg: payload.profileHints?.weightKg ?? prev.weightKg,
      sex: payload.profileHints?.sex && isSex(payload.profileHints.sex) ? payload.profileHints.sex : prev.sex,
    }));
  }, []);

  const load = useCallback(async ({ preferCache = false }: { preferCache?: boolean } = {}) => {
    const cached = preferCache ? readCachedValue<ProgramCachePayload>(cacheKey) : null;
    setLoading(!cached);
    setError(null);
    if (cached) applyPayload(cached);
    try {
      const data = (await fetchJson('/api/program')) as ProgramOverview;
      const payload: ProgramCachePayload = {
        activePrograms: Array.isArray(data.activePrograms) ? data.activePrograms : [],
        history: Array.isArray(data.history) ? data.history : [],
        profileHints: data.profileHints || { ageYears: null, weightKg: null, sex: null },
      };
      applyPayload(payload);
      writeCachedValue(cacheKey, payload);
    } catch (e) {
      if (!cached) setError(tt(getErrorMessage(e) || 'Не удалось загрузить программу'));
    } finally {
      setLoading(false);
    }
  }, [applyPayload, cacheKey, tt]);

  useEffect(() => {
    void load({ preferCache: true });
  }, [load]);

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
    return suggestFrequencyPerWeek({
      exerciseType: resolvedForm.exerciseType,
      baselineMaxReps: resolvedForm.baselineMaxReps,
      targetReps: resolvedForm.targetReps,
      ageYears: resolvedForm.ageYears,
      weightKg: resolvedForm.weightKg,
    });
  }, [resolvedForm.exerciseType, resolvedForm.baselineMaxReps, resolvedForm.targetReps, resolvedForm.ageYears, resolvedForm.weightKg]);

  const recommendedDuration = useMemo(() => {
    return suggestDurationWeeks({
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

  const formKind: ProgramKind = programKind(form.exerciseType) ?? 'reps';
  const isDistanceForm = formKind === 'distance';
  // Выходы силой с максимумом 0: программа не стартует, вместо неё — подтягивания и брусья.
  const startAlternatives = step >= 2 ? programStartAlternatives(form.exerciseType, resolvedForm.baselineMaxReps) : [];

  const canNextStep = useMemo(() => {
    if (step === 1) return Boolean(form.exerciseType);
    if (step === 2) {
      if (programStartAlternatives(form.exerciseType, resolvedForm.baselineMaxReps).length) return false;
      if (programKind(form.exerciseType) === 'loaded' && !form.loadKg) return false;
      return Number.isFinite(resolvedForm.baselineMaxReps) && resolvedForm.baselineMaxReps > 0;
    }
    if (step === 3) {
      return (
        Number.isFinite(resolvedForm.targetReps) &&
        resolvedForm.targetReps > 0 &&
        resolvedForm.targetReps >= resolvedForm.baselineMaxReps
      );
    }
    if (step === 4) {
      if (programKind(form.exerciseType) === 'distance') return true;
      return (
        resolvedForm.frequencyPerWeek >= 1 &&
        resolvedForm.frequencyPerWeek <= 6 &&
        resolvedForm.durationWeeks >= 4 &&
        resolvedForm.durationWeeks <= 24 &&
        resolvedForm.ageYears >= 8 &&
        resolvedForm.ageYears <= 90 &&
        resolvedForm.weightKg >= 30 &&
        resolvedForm.weightKg <= 250
      );
    }
    return false;
  }, [form.exerciseType, form.loadKg, resolvedForm, step]);

  /** Сменить упражнение мастера: база, цель и гиря — по умолчанию для его вида. */
  const chooseExercise = useCallback((type: CatalogExerciseType, loadKg?: number | null) => {
    const defaults = exerciseDefaults(type);
    setForm((prev) => ({ ...prev, exerciseType: type, ...defaults, ...(loadKg != null ? { loadKg } : {}) }));
    setKmDrafts({ baseline: metersToKmText(defaults.baselineMaxReps), target: metersToKmText(defaults.targetReps) });
    setFormDrafts({});
  }, []);

  const openWizard = useCallback((startStep: number) => {
    setShowCreate(true);
    setStep(startStep);
    setInfo(null);
    setError(null);
    setFrequencyManual(false);
    setDurationManual(false);
  }, []);

  const beginCreate = () => {
    const nextFreq = recommendedFrequency;
    const nextDuration = suggestDurationWeeks({
      exerciseType: resolvedForm.exerciseType,
      baselineMaxReps: resolvedForm.baselineMaxReps,
      targetReps: resolvedForm.targetReps,
      ageYears: resolvedForm.ageYears,
      weightKg: resolvedForm.weightKg,
      frequencyPerWeek: nextFreq,
    });
    openWizard(1);
    setFormDrafts({});
    setForm((prev) => ({ ...prev, frequencyPerWeek: nextFreq, durationWeeks: nextDuration }));
  };

  /** Начать программу по другому упражнению (подводящие к выходам силой, следующая гиря) — со 2-го шага. */
  const startProgramFor = useCallback((type: CatalogExerciseType, loadKg?: number | null) => {
    chooseExercise(type, loadKg);
    openWizard(2);
  }, [chooseExercise, openWizard]);

  // `/program?start=<упражнение>&loadKg=<кг>` — ссылка «следующая гиря» со страницы программы.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const start = params.get('start');
    if (!start || !isExerciseType(start)) return;
    const kg = Number(params.get('loadKg'));
    startProgramFor(start, Number.isFinite(kg) && kg > 0 ? kg : null);
  }, [startProgramFor]);

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
          loadKg: formKind === 'loaded' ? form.loadKg : undefined,
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
      setInfo(tt('Программа создана'));
      await load();
    } catch (e) {
      setError(tt(getErrorMessage(e) || 'Не удалось создать программу'));
    } finally {
      setBusy(false);
    }
  };

  const handleDeactivate = async (programId: string) => {
    const ok = window.confirm(tt('Прервать эту программу?'));
    if (!ok) return;

    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fetchJson(`/api/program/${programId}/deactivate`, { method: 'POST' });
      setInfo(tt('Программа прервана'));
      await load();
    } catch (e) {
      setError(tt(getErrorMessage(e) || 'Не удалось деактивировать программу'));
    } finally {
      setBusy(false);
    }
  };

  const sessionRows = useMemo(() => {
    const out: SessionRow[] = [];
    activePrograms.forEach((program) => {
      program.sessions.forEach((session) => out.push({
        ...session,
        exerciseType: program.exerciseType,
        programType: program.programType,
        loadKg: program.loadKg,
        circuitPlanId: program.circuitPlanId,
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
    const map = new Map<string, { upcoming: number; completed: number; sessions: SessionRow[] }>();
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

  // Легенда календаря — только упражнения, чьи иконки видны в показанном месяце.
  const calendarTypes = useMemo(() => {
    const present = new Set<string>();
    calendarCells.forEach((cell) => {
      if (!cell) return;
      (sessionsByDay.get(cell.key)?.sessions || []).forEach((session) => present.add(session.exerciseType));
    });
    return EXERCISE_ORDER.filter((type) => present.has(type));
  }, [calendarCells, sessionsByDay]);

  const calendarWeekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(tt);
  const todayKey = dayKeyFromIso(new Date().toISOString());
  const selectedDaySessions = selectedDayKey
    ? (sessionsByDay.get(selectedDayKey)?.sessions || []).filter((session) => !session.completed)
    : [];

  // Гиревая программа пройдена, а новой по этому упражнению нет — предложить следующую гирю (R08.5).
  const nextLoadOffer = useMemo(() => {
    const activeTypes = new Set(activePrograms.map((p) => p.exerciseType));
    const seen = new Set<string>();
    for (const row of history) {
      if (seen.has(row.exerciseType)) continue;
      seen.add(row.exerciseType);
      if (row.status !== 'completed' || row.nextLoadKg == null || activeTypes.has(row.exerciseType)) continue;
      if (!isExerciseType(row.exerciseType)) continue;
      return { row, exerciseType: row.exerciseType, nextLoadKg: row.nextLoadKg };
    }
    return null;
  }, [activePrograms, history]);

  const sessionTitle = (session: SessionRow) => {
    const label = programLabel(session, locale);
    return session.sessionKind ? `${label} · ${text.sessionKind[session.sessionKind]}` : label;
  };

  return (
    <div className="app-page" style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={btnPrimary} onClick={beginCreate}>
          {tt('Новая программа тренировок')}
        </button>
      </div>

      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}
      {info ? <p style={{ color: '#16a34a' }}>{info}</p> : null}
      {nextLoadOffer && !loading ? (
        <section style={{ ...card, borderColor: '#93c5fd', background: '#eff6ff' }} data-testid="program-next-load">
          <div style={{ fontWeight: 900 }}>{text.nextLoad.done(programLabel(nextLoadOffer.row, locale))}</div>
          <div style={{ marginTop: 4 }}>{text.nextLoad.offer(formatKg(nextLoadOffer.nextLoadKg, locale))}</div>
          <button
            type="button"
            style={{ ...btnPrimary, marginTop: 8 }}
            onClick={() => startProgramFor(nextLoadOffer.exerciseType, nextLoadOffer.nextLoadKg)}
          >
            {text.nextLoad.start}
          </button>
        </section>
      ) : null}
      {loading ? <p>{tt('Загрузка…')}</p> : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>{tt('Следующая тренировка')}</h2>
          {activePrograms.length === 0 ? (
            <div style={{ color: '#6b7280' }}>{tt('Активных программ нет. Когда будете готовы, начните новую программу.')}</div>
          ) : !nextSession ? (
            <div style={{ color: '#6b7280' }}>{tt('Предстоящих тренировок не найдено.')}</div>
          ) : (
            <div style={{ ...programCard, padding: '8px 10px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ display: 'grid', gap: 4 }}>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{ ...nextExerciseDot, background: exerciseLegendColor(nextSession.exerciseType) }}
                      title={sessionTitle(nextSession)}
                    />
                    <span style={{ fontWeight: 900 }}>{renderSessionSetPlan(nextSession, nextSession.exerciseType, locale)}</span>
                  </div>
                  <div style={{ fontSize: 13, color: '#374151' }}>
                    {sessionTitle(nextSession)} · {formatSessionDate(nextSession.scheduledAt, localeTag)}
                  </div>
                </div>
                <Link href={programSessionHref(nextSession.id)} style={{ ...btnPrimaryLink, padding: '8px 10px' }}>
                  {tt('Приступить')}
                </Link>
              </div>
            </div>
          )}
        </section>
      ) : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>{tt('Календарь программ')}</h2>
          {sessionRows.length === 0 ? (
            <div style={{ color: '#6b7280' }}>{tt('Пока нет запланированных тренировок.')}</div>
          ) : (
            <div style={calendarWrap}>
              <div style={calendarNavWrap}>
                <div style={{ fontWeight: 900, fontSize: 18, textAlign: 'center' }}>{formatMonthTitle(calendarMonth, localeTag)}</div>
                <div style={calendarNavButtons}>
                  <button type="button" style={btnSecondary} onClick={() => setCalendarMonth((d) => addCalendarMonths(d, -1))}>
                    {tt('Предыдущий')}
                  </button>
                  <button type="button" style={btnSecondary} onClick={() => setCalendarMonth((d) => addCalendarMonths(d, 1))}>
                    {tt('Следующий')}
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
                            <Image
                              key={exerciseType}
                              src={exerciseFeedIcon(exerciseType)}
                              alt={exerciseLabel(exerciseType)}
                              width={24}
                              height={24}
                              style={calendarExerciseIcon}
                              title={exerciseLabel(exerciseType)}
                              unoptimized
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
                        title={tt('Открыть тренировки этого дня')}
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
                {calendarTypes.map((exerciseType) => (
                  <div key={exerciseType} style={calendarLegendItem}>
                    <Image src={exerciseFeedIcon(exerciseType)} alt={tt(exerciseLabel(exerciseType))} width={24} height={24} style={calendarLegendIcon} unoptimized />
                    <span>{tt(exerciseLabel(exerciseType))}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>
      ) : null}

      {!loading ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>{tt('Активные программы')}</h2>
          {activePrograms.length === 0 ? (
            <div style={{ color: '#6b7280' }}>{tt('Активных программ пока нет.')}</div>
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
                          {programLabel(program, locale)}
                        </div>
                      </div>
                      <div style={{ marginTop: 4, color: '#111827' }}>
                        {tt('База')}: <b>{formatExerciseValue(program.baselineMaxReps, program.exerciseType, true, locale)}</b> · {tt('Цель')}: <b>{formatExerciseValue(program.targetReps, program.exerciseType, true, locale)}</b> · {tt('Длительность')}: <b>{program.durationWeeks}</b> {tt('нед')}
                      </div>
                      <div style={{ marginTop: 4, color: '#111827' }}>
                        {tt('Темп')}: <b>{program.frequencyPerWeek}</b>/{tt('нед')} · {tt('Прогресс')}: <b>{program.stats.completionPercent}%</b>
                      </div>
                      {program.stats.nextSession ? (
                        <div style={{ marginTop: 4, color: '#111827' }}>
                          {tt('Ближайшая')}: <b>{formatSessionDateTime(program.stats.nextSession.scheduledAt, localeTag)}</b>
                        </div>
                      ) : null}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link href={programHref(program.id)} style={btnLink}>
                        {tt('Открыть программу')}
                      </Link>
                      <button
                        type="button"
                        style={btnDanger}
                        onClick={() => handleDeactivate(program.id)}
                        disabled={busy}
                      >
                        {tt('Прервать')}
                      </button>
                    </div>
                  </div>
                  {program.warnings?.length ? (
                    <div style={{ marginTop: 8, padding: 10, borderRadius: 10, border: '1px solid #f59e0b', background: '#fffbeb' }}>
                      <div style={{ fontWeight: 900, marginBottom: 6 }}>{tt('Внимание')}</div>
                      {program.warnings.map((w, i) => (
                        <div key={i} style={{ fontSize: 14, marginTop: i ? 4 : 0 }}>{tt(w)}</div>
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
          <h2 style={{ marginTop: 0 }}>{tt('История программ')}</h2>
          {history.length === 0 ? (
            <div>{tt('Пока нет завершённых или отключённых программ.')}</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {history.map((row) => (
                <div key={row.id} style={historyCard}>
                  <div style={{ fontWeight: 900 }}>
                    {programLabel(row, locale)} · {tt('цель')}: {formatExerciseValue(row.targetReps, row.exerciseType, true, locale)}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>
                    {new Date(row.createdAt).toLocaleDateString(localeTag)} · {tt('статус')}: {tt(row.status)}
                  </div>
                  <div style={{ fontSize: 13, color: '#374151', marginTop: 2 }}>
                    {tt('Начато')}: {new Date(row.startedAt).toLocaleDateString(localeTag)}
                    {' · '}
                    {tt('Завершено')}: {row.finishedAt ? new Date(row.finishedAt).toLocaleDateString(localeTag) : '—'}
                  </div>
                  <div style={{ marginTop: 6, fontSize: 14 }}>
                    {tt('Выполнено')}: {row.completedSessions}/{row.totalSessions} ({row.completionPercent}%)
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <Sheet
        open={Boolean(selectedDayKey)}
        onClose={() => setSelectedDayKey(null)}
        title={selectedDayKey ? formatDayTitle(selectedDayKey, localeTag) : ''}
        wide
        testId="program-day-sheet"
      >
        <div style={{ display: 'grid', gap: 10 }}>
          {selectedDaySessions.length === 0 ? (
            <div style={{ color: '#6b7280' }}>{tt('На эту дату нет запланированных тренировок.')}</div>
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
                        title={tt(exerciseLabel(session.exerciseType))}
                      >
                        {exerciseCode(session.exerciseType)}
                      </span>
                      <span style={{ fontWeight: 900 }}>{sessionTitle(session)}</span>
                    </div>
                    <div style={{ marginTop: 4, color: '#111827' }}>
                      {formatSessionDateTime(session.scheduledAt, localeTag)} · {tt('тренировка')} #{session.sessionNumber}
                      {session.isFinalTest ? ` · ${tt('финальный тест')}` : ''}
                    </div>
                    <div style={{ marginTop: 4, color: '#111827' }}>
                      {tt('План')}: <b>{renderSessionSetPlan(session, session.exerciseType, locale)}</b>
                    </div>
                  </div>
                  {session.completed ? (
                    <span style={doneBadge}>{tt('Выполнено')}</span>
                  ) : (
                    <Link href={programSessionHref(session.id)} style={btnPrimaryLink}>
                      {tt('Приступить')}
                    </Link>
                  )}
                </div>
              </div>
            ))}
        </div>
      </Sheet>

      <Sheet
        open={showCreate}
        onClose={cancelCreate}
        title={tt('Новая программа тренировок')}
        testId="program-wizard"
        footer={(
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" style={btnSecondary} onClick={cancelCreate} disabled={busy}>{tt('Отмена')}</button>
            {step > 1 ? (
              <button type="button" style={btnSecondary} onClick={() => setStep((s) => s - 1)} disabled={busy}>{tt('Назад')}</button>
            ) : null}
            {step < 4 ? (
              <button type="button" style={btnPrimary} onClick={() => setStep((s) => s + 1)} disabled={!canNextStep || busy}>{tt('Далее')}</button>
            ) : (
              <button type="button" style={btnPrimary} onClick={submitCreate} disabled={!canNextStep || busy}>
                {tt('Сгенерировать программу')}
              </button>
            )}
          </div>
        )}
      >
        <div style={{ marginBottom: 10, color: '#4b5563' }}>{tt(`Шаг ${step} из 4`)}</div>

        {step === 1 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <div style={labelRow}>
              <label htmlFor="program-exercise">{tt('1) Выберите упражнение')}</label>
              <InfoButton title={tt('1) Выберите упражнение')}>{text.wizard.exerciseInfo}</InfoButton>
            </div>
            <select
              id="program-exercise"
              value={form.exerciseType}
              onChange={(e) => {
                const nextValue = e.target.value;
                if (!isExerciseType(nextValue)) return;
                chooseExercise(nextValue);
              }}
              style={inputStyle}
            >
              {EXERCISE_ORDER.map((type) => (
                <option key={type} value={type}>{catalogExerciseLabel(type, locale)}</option>
              ))}
            </select>
            <div style={hint}>
              {text.wizard.kind[formKind]}
              {isUnilateralExercise(form.exerciseType) ? ` (${text.wizard.perSide})` : ''}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            {formKind === 'loaded' ? (
              <>
                <label htmlFor="program-load">{text.wizard.loadLabel}</label>
                <select
                  id="program-load"
                  value={form.loadKg ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, loadKg: Number(e.target.value) || null }))}
                  style={inputStyle}
                >
                  {(EXERCISES[form.exerciseType].load?.presetsKg ?? []).map((kg) => (
                    <option key={kg} value={kg}>{formatKg(kg, locale)} {locale === 'en' ? 'kg' : 'кг'}</option>
                  ))}
                </select>
              </>
            ) : null}
            <div style={labelRow}>
              <label htmlFor="program-baseline">
                {text.wizard.baseline[formKind]}
                {isUnilateralExercise(form.exerciseType) ? `, ${text.wizard.perSide}` : ''}
              </label>
              <InfoButton title={text.wizard.baseline[formKind]}>{text.wizard.baselineInfo}</InfoButton>
            </div>
            {isDistanceForm ? (
              <input
                id="program-baseline"
                type="text"
                inputMode="decimal"
                value={kmDrafts.baseline}
                onChange={(e) => {
                  const raw = e.target.value;
                  setKmDrafts((d) => ({ ...d, baseline: raw }));
                  setForm((f) => ({ ...f, baselineMaxReps: kmTextToMeters(raw) }));
                }}
                style={inputStyle}
              />
            ) : (
              <input
                id="program-baseline"
                type="number"
                min={form.exerciseType === 'muscle_ups' ? 0 : 1}
                max={500}
                value={numericInputValue('baselineMaxReps')}
                onChange={(e) => setNumericField('baselineMaxReps', e.target.value)}
                style={inputStyle}
              />
            )}
            {startAlternatives.length ? (
              <div style={blockNote} role="status" data-testid="program-start-alternatives">
                <div style={{ fontWeight: 900 }}>{text.muscleUps.title}</div>
                <div style={{ marginTop: 4 }}>{text.muscleUps.body}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                  {startAlternatives.map((type) => (
                    <button key={type} type="button" style={btnPrimary} onClick={() => startProgramFor(type)}>
                      {type === 'pullups' ? text.muscleUps.pullups : type === 'dips' ? text.muscleUps.dips : catalogExerciseLabel(type, locale)}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 3 ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <label htmlFor="program-target">
              {text.wizard.target[formKind]}
              {isUnilateralExercise(form.exerciseType) ? `, ${text.wizard.perSide}` : ''}
            </label>
            {isDistanceForm ? (
              <input
                id="program-target"
                type="text"
                inputMode="decimal"
                value={kmDrafts.target}
                onChange={(e) => {
                  const raw = e.target.value;
                  setKmDrafts((d) => ({ ...d, target: raw }));
                  setForm((f) => ({ ...f, targetReps: kmTextToMeters(raw) }));
                }}
                style={inputStyle}
              />
            ) : (
              <input
                id="program-target"
                type="number"
                min={Math.max(1, resolvedForm.baselineMaxReps)}
                max={1000}
                value={numericInputValue('targetReps')}
                onChange={(e) => setNumericField('targetReps', e.target.value)}
                style={inputStyle}
              />
            )}
          </div>
        ) : null}

        {step === 4 && isDistanceForm ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <label>{tt('4) Настройки плана')}</label>
            <div>{text.wizard.distancePlan}</div>
            <div style={{ fontWeight: 900 }}>{text.wizard.distanceWeeks(recommendedDuration)}</div>
          </div>
        ) : null}

        {step === 4 && !isDistanceForm ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <div style={labelRow}>
              <label>{tt('4) Настройки плана')}</label>
              <InfoButton title={tt('4) Настройки плана')}>{text.wizard.planInfo}</InfoButton>
            </div>

            <div style={grid2}>
              <div>
                <div style={{ marginBottom: 4 }}>{tt('Темп тренировок (в неделю)')}</div>
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
                <div style={hint}>{tt('Рекомендовано')}: {recommendedFrequency}/{tt('нед')}</div>
                {form.frequencyPerWeek !== recommendedFrequency ? (
                  <button
                    type="button"
                    style={{ ...btnText, marginTop: 4 }}
                    onClick={() => {
                      setFrequencyManual(false);
                      applyNumericField('frequencyPerWeek', recommendedFrequency);
                    }}
                  >
                    {tt('Вернуть рекомендованный темп')}
                  </button>
                ) : null}
              </div>

              <div>
                <div style={{ marginBottom: 4 }}>{tt('Длительность программы (недели)')}</div>
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
                <div style={hint}>{tt('Рекомендовано')}: {recommendedDuration} {tt('недель')}</div>
                {form.durationWeeks !== recommendedDuration ? (
                  <button
                    type="button"
                    style={{ ...btnText, marginTop: 4 }}
                    onClick={() => {
                      setDurationManual(false);
                      applyNumericField('durationWeeks', recommendedDuration);
                    }}
                  >
                    {tt('Вернуть рекомендованную длительность')}
                  </button>
                ) : null}
              </div>
            </div>

            <div style={grid2}>
              <div>
                <div style={{ ...labelRow, marginBottom: 4 }}>
                  <span>{tt('Возраст')}</span>
                  {profileHints.ageYears != null ? <InfoButton title={tt('Возраст')}>{text.wizard.profileInfo}</InfoButton> : null}
                </div>
                <input
                  type="number"
                  min={12}
                  max={90}
                  value={numericInputValue('ageYears')}
                  disabled={profileHints.ageYears != null}
                  onChange={(e) => setNumericField('ageYears', e.target.value)}
                  style={{ ...inputStyle, opacity: profileHints.ageYears != null ? 0.7 : 1 }}
                />
              </div>

              <div>
                <div style={{ ...labelRow, marginBottom: 4 }}>
                  <span>{tt('Вес (кг)')}</span>
                  {profileHints.weightKg != null ? <InfoButton title={tt('Вес (кг)')}>{text.wizard.profileInfo}</InfoButton> : null}
                </div>
                <input
                  type="number"
                  min={30}
                  max={250}
                  value={numericInputValue('weightKg')}
                  disabled={profileHints.weightKg != null}
                  onChange={(e) => setNumericField('weightKg', e.target.value)}
                  style={{ ...inputStyle, opacity: profileHints.weightKg != null ? 0.7 : 1 }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </Sheet>
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

const labelRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  flexWrap: 'wrap',
};

const blockNote: React.CSSProperties = {
  marginTop: 6,
  padding: 10,
  borderRadius: 10,
  border: '1px solid #f59e0b',
  background: '#fffbeb',
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
