'use client';

import Image from 'next/image';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';
import { exerciseValueLabel, formatExerciseValue, isTimedExercise } from '@/lib/exercise-metrics';
import { getStoredExerciseType, persistExerciseType, subscribeExerciseType, type ExerciseType } from '@/lib/exercise-type-store';
import styles from './dashboard.module.css';

type Workout = {
  id: string;
  reps: number;
  date: string;
  time?: string;
  exerciseType?: string;
};

type WorkoutReward = {
  id: string;
  message: string;
  minPoints: number;
  earnedPoints: number;
};

type DayAggregate = {
  items: Workout[];
  byExercise: Map<string, number>;
  totalReps: number;
};

type Stats = {
  totalAll: number;
  totalToday: number;
  totalWeek: number;
  totalMonth: number;
  totalYear: number;
  avgPerDayMonth: number;
  avgPerDayYear: number;
  avgPerDayAll: number;
  streak: number;
};

type StatBreakdown = Record<ExerciseType, number | string>;

type WorkoutReactionPayload = {
  summary: Array<{ emoji: string; count: number }>;
  myEmoji: string | null;
  recent: Array<{
    id: string;
    userId: string;
    username: string;
    avatarPath: string | null;
    emoji: string;
    createdAt: string;
  }>;
};

type ReactionSummaryItem = {
  emoji: string;
  count: number;
  avatars: WorkoutReactionPayload['recent'];
  hasMore: boolean;
};

type JsonObject = Record<string, unknown>;

type CachedWorkoutsPayload = {
  items: Workout[];
  updatedAt: string;
};

const EXERCISE_ORDER: ExerciseType[] = ['pushups', 'pullups', 'crunches', 'squats', 'plank'];
const REACTION_OPTIONS = ['👍', '🔥', '👎', '💩'] as const;
const WORKOUTS_CACHE_VERSION = '20260327-1';

const EXERCISE_LABELS: Record<string, string> = {
  pushups: 'Отжимания',
  pullups: 'Подтягивания',
  crunches: 'Скручивания',
  squats: 'Приседания',
  plank: 'Планка',
};

function toIsoTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
}

function readWorkoutReward(data: unknown): WorkoutReward | null {
  if (!isJsonObject(data) || !isJsonObject(data.reward)) return null;
  const reward = data.reward;
  if (typeof reward.message !== 'string') return null;
  const minPoints = Number(reward.minPoints);
  const earnedPoints = Number(reward.earnedPoints);
  if (!Number.isFinite(minPoints) || !Number.isFinite(earnedPoints)) return null;
  return {
    id: String(reward.id || ''),
    message: reward.message,
    minPoints,
    earnedPoints,
  };
}

function normalizeDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function normalizeTime(d: Date) {
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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

function formatTimeHHMM(iso: string | undefined, locale: string) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function formatDateWithWeekday(dayKey: string, locale: string) {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(locale, {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function getWorkoutsCacheKey(userId?: string, username?: string): string | null {
  const identity = userId || username;
  return identity ? `dashboard-workouts:${WORKOUTS_CACHE_VERSION}:${identity}` : null;
}

function readCachedWorkouts(cacheKey: string | null): CachedWorkoutsPayload | null {
  if (!cacheKey || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(cacheKey);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonObject(parsed) || !Array.isArray(parsed.items)) return null;
    return {
      items: parsed.items as Workout[],
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : '',
    };
  } catch {
    return null;
  }
}

function writeCachedWorkouts(cacheKey: string | null, items: Workout[]) {
  if (!cacheKey || typeof window === 'undefined') return;
  try {
    const payload: CachedWorkoutsPayload = {
      items,
      updatedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(cacheKey, JSON.stringify(payload));
  } catch {}
}

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {}
  }
  if (!res.ok) {
    const base = isJsonObject(data) && typeof data.error === 'string' ? data.error : `Ошибка (код ${res.status})`;
    const details = isJsonObject(data) && typeof data.details === 'string' ? data.details : '';
    throw new Error(details ? `${base}: ${details}` : base);
  }
  return data;
}

function computeStats(workouts: Workout[]): Stats {
  const byDay = new Map<string, number>();
  workouts.forEach((w) => {
    const key = normalizeDate(new Date(w.time || w.date));
    byDay.set(key, (byDay.get(key) ?? 0) + (w.reps || 0));
  });

  const msInDay = 1000 * 60 * 60 * 24;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const dow = today.getDay();
  const offsetToMonday = (dow + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - offsetToMonday);

  const monthStartDate = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);
  const daysMonth = Math.floor((today.getTime() - monthStartDate.getTime()) / msInDay) + 1;
  const daysYear = Math.floor((today.getTime() - yearStart.getTime()) / msInDay) + 1;

  let totalAll = 0;
  let totalWeek = 0;
  let totalMonth = 0;
  let totalYear = 0;

  for (const [dayKey, repsSum] of byDay.entries()) {
    totalAll += repsSum;
    const [y, m, d] = dayKey.split('-').map(Number);
    const dayDate = new Date(y, (m || 1) - 1, d || 1);

    if (dayDate >= weekStart && dayDate <= today) totalWeek += repsSum;
    if (dayDate >= monthStartDate && dayDate <= today) totalMonth += repsSum;
    if (dayDate >= yearStart && dayDate <= today) totalYear += repsSum;
  }

  let avgPerDayAll = 0;
  if (byDay.size > 0) {
    const firstKey = Array.from(byDay.keys()).sort()[0];
    const [fy, fm, fd] = firstKey.split('-').map(Number);
    const firstDate = new Date(fy, (fm || 1) - 1, fd || 1);
    const daysAll = Math.floor((today.getTime() - firstDate.getTime()) / msInDay) + 1;
    avgPerDayAll = daysAll > 0 ? Math.round(totalAll / daysAll) : 0;
  }

  let streak = 0;
  const allDays = Array.from(byDay.keys()).sort().reverse();
  if (allDays.length > 0) {
    const [ly, lm, ld] = allDays[0].split('-').map(Number);
    let cursor = new Date(ly, (lm || 1) - 1, ld || 1);
    while (true) {
      const key = normalizeDate(cursor);
      if (byDay.has(key)) {
        streak += 1;
        cursor = new Date(cursor.getTime() - msInDay);
      } else {
        break;
      }
    }
  }

  const totalToday = byDay.get(normalizeDate(today)) ?? 0;

  return {
    totalAll,
    totalToday,
    totalWeek,
    totalMonth,
    totalYear,
    avgPerDayMonth: daysMonth > 0 ? Math.round(totalMonth / daysMonth) : 0,
    avgPerDayYear: daysYear > 0 ? Math.round(totalYear / daysYear) : 0,
    avgPerDayAll,
    streak,
  };
}

function Stat({ label, value, breakdown }: { label: string; value: number | string; breakdown?: StatBreakdown }) {
  return (
    <div className={`app-tile${breakdown ? ' app-tile--breakdown' : ''}`}>
      <div className="app-tile__title">{label}</div>
      {!breakdown ? <div className="app-tile__value">{value}</div> : null}
      {breakdown ? (
        <div style={statBreakdownWrap}>
          {EXERCISE_ORDER.map((type) => (
            <span key={`${label}-${type}`} style={statBreakdownItem}>
              <Image src={exerciseFeedIcon(type)} alt="" aria-hidden="true" width={20} height={20} style={statBreakdownIcon} unoptimized />
              <span style={statBreakdownValue}>{breakdown[type]}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function exerciseLabel(type: string | undefined) {
  return EXERCISE_LABELS[type || ''] || type || 'Упражнение';
}

function normalizeExerciseType(type: string | undefined): ExerciseType {
  if (type === 'pullups' || type === 'crunches' || type === 'squats' || type === 'plank') return type;
  return 'pushups';
}

function exerciseFeedIcon(type: string | undefined) {
  const v = '20260315-2';
  if (type === 'pullups') return `/icons/exercise-types/feed/pullups.svg?v=${v}`;
  if (type === 'crunches') return `/icons/exercise-types/feed/crunches.svg?v=${v}`;
  if (type === 'squats') return `/icons/exercise-types/feed/squats.svg?v=${v}`;
  if (type === 'plank') return `/icons/exercise-types/feed/plank.svg?v=${v}`;
  return `/icons/exercise-types/feed/pushups.svg?v=${v}`;
}

function buildReactionSummaryItem(
  reaction: WorkoutReactionPayload | undefined,
  emoji: string,
): ReactionSummaryItem | null {
  const count = reaction?.summary?.find((x) => x.emoji === emoji)?.count ?? 0;
  if (!count) return null;

  const avatars = (reaction?.recent ?? []).filter((x) => x.emoji === emoji).slice(0, 3);
  return {
    emoji,
    count,
    avatars,
    hasMore: count > avatars.length,
  };
}

function AvatarMini({ src }: { src?: string | null }) {
  if (!src) return <span style={miniAvatarPlaceholder} aria-hidden="true" />;
  return (
    <span style={miniAvatarWrap} aria-hidden="true">
      <Image src={src} alt="" width={14} height={14} unoptimized style={{ width: 14, height: 14, objectFit: 'cover', display: 'block' }} />
    </span>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { locale, messages } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const exerciseType = useSyncExternalStore<ExerciseType>(subscribeExerciseType, getStoredExerciseType, () => 'pushups');
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  const [date, setDate] = useState<string>(normalizeDate(new Date()));
  const [time, setTime] = useState<string>(normalizeTime(new Date()));
  const [timeTouched, setTimeTouched] = useState(false);
  const [reps, setReps] = useState<number>(0);
  const [plankSecondsLeft, setPlankSecondsLeft] = useState(0);
  const [plankTimerActive, setPlankTimerActive] = useState(false);
  const [plankTimerStarted, setPlankTimerStarted] = useState(false);

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>(normalizeDate(new Date()));
  const [editTime, setEditTime] = useState<string>(normalizeTime(new Date()));
  const [editReps, setEditReps] = useState<number>(0);
  const [editExerciseType, setEditExerciseType] = useState<ExerciseType>('pushups');

  const [calendarMonth, setCalendarMonth] = useState<Date>(() => monthStart(new Date()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailDay, setDetailDay] = useState<string | null>(null);
  const [workoutReactions, setWorkoutReactions] = useState<Record<string, WorkoutReactionPayload>>({});
  const [initialLoadReady, setInitialLoadReady] = useState(false);
  const repsRef = useRef(reps);
  const plankSecondsLeftRef = useRef(plankSecondsLeft);
  const isPlankSelected = exerciseType === 'plank';
  const plankElapsedSeconds = useMemo(
    () => Math.max(0, Math.max(0, reps) - Math.max(0, plankSecondsLeft)),
    [reps, plankSecondsLeft],
  );
  const workoutsCacheKey = useMemo(
    () => getWorkoutsCacheKey(user?.id, user?.username),
    [user?.id, user?.username],
  );

  useEffect(() => {
    repsRef.current = reps;
    plankSecondsLeftRef.current = plankSecondsLeft;
  }, [reps, plankSecondsLeft]);

  const handleExerciseTypeChange = (next: ExerciseType) => {
    if (next !== 'plank') {
      setPlankTimerActive(false);
      setPlankTimerStarted(false);
      setPlankSecondsLeft(0);
    }
    persistExerciseType(next);
  };

  const applyLoadedWorkouts = useCallback((items: Workout[]) => {
    setWorkouts(items);
  }, []);

  const loadWorkouts = useCallback(async () => {
    setError(null);
    try {
      const data = await fetchJsonSafe('/api/workouts');
      const items = Array.isArray(data)
        ? (data as Workout[])
        : isJsonObject(data) && Array.isArray(data.items)
          ? (data.items as Workout[])
          : [];
      applyLoadedWorkouts(items);
      writeCachedWorkouts(workoutsCacheKey, items);
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    }
  }, [applyLoadedWorkouts, workoutsCacheKey]);

  useEffect(() => {
    let cancelled = false;

    const loadInitialWorkouts = async () => {
      const cached = readCachedWorkouts(workoutsCacheKey);
      if (cached && !cancelled) {
        applyLoadedWorkouts(cached.items);
        setInitialLoadReady(true);
      }

      try {
        const data = await fetchJsonSafe('/api/workouts');
        const items = Array.isArray(data)
          ? (data as Workout[])
          : isJsonObject(data) && Array.isArray(data.items)
            ? (data.items as Workout[])
            : [];
        if (cancelled) return;
        applyLoadedWorkouts(items);
        writeCachedWorkouts(workoutsCacheKey, items);
      } catch (error: unknown) {
        if (cancelled) return;
        if (cached) return;
        setError(getErrorMessage(error));
      } finally {
        if (!cancelled) setInitialLoadReady(true);
      }
    };

    void loadInitialWorkouts();
    return () => {
      cancelled = true;
    };
  }, [applyLoadedWorkouts, workoutsCacheKey]);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 1000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const stats = useMemo(() => computeStats(workouts), [workouts]);
  const statsByExercise = useMemo<Record<ExerciseType, Stats>>(() => ({
    pushups: computeStats(workouts.filter((w) => normalizeExerciseType(w.exerciseType) === 'pushups')),
    pullups: computeStats(workouts.filter((w) => normalizeExerciseType(w.exerciseType) === 'pullups')),
    crunches: computeStats(workouts.filter((w) => normalizeExerciseType(w.exerciseType) === 'crunches')),
    squats: computeStats(workouts.filter((w) => normalizeExerciseType(w.exerciseType) === 'squats')),
    plank: computeStats(workouts.filter((w) => normalizeExerciseType(w.exerciseType) === 'plank')),
  }), [workouts]);

  const breakdownFromStats = (pick: (s: Stats) => number): StatBreakdown => ({
    pushups: pick(statsByExercise.pushups),
    pullups: pick(statsByExercise.pullups),
    crunches: pick(statsByExercise.crunches),
    squats: pick(statsByExercise.squats),
    plank: pick(statsByExercise.plank),
  });
  const selectedStats = statsByExercise[exerciseType];

  const dayMap = useMemo(() => {
    const map = new Map<string, DayAggregate>();
    workouts.forEach((w) => {
      const key = normalizeDate(new Date(w.time || w.date));
      const row = map.get(key) || { items: [], byExercise: new Map<string, number>(), totalReps: 0 };
      row.items.push(w);
      const t = normalizeExerciseType(w.exerciseType);
      row.byExercise.set(t, (row.byExercise.get(t) ?? 0) + (w.reps || 0));
      row.totalReps += w.reps || 0;
      map.set(key, row);
    });

    for (const row of map.values()) {
      row.items.sort((a, b) => new Date(b.time || b.date).getTime() - new Date(a.time || a.date).getTime());
    }

    return map;
  }, [workouts]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (first.getDay() + 6) % 7;
    const out: Array<{ key: string; day: number; inCurrentMonth: boolean }> = [];

    for (let i = mondayOffset; i > 0; i -= 1) {
      const d = new Date(year, month, 1 - i);
      out.push({
        key: normalizeDate(d),
        day: d.getDate(),
        inCurrentMonth: false,
      });
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(year, month, day);
      const key = normalizeDate(d);
      out.push({ key, day, inCurrentMonth: true });
    }
    let trailingDay = 1;
    while (out.length % 7 !== 0) {
      const d = new Date(year, month + 1, trailingDay);
      out.push({
        key: normalizeDate(d),
        day: d.getDate(),
        inCurrentMonth: false,
      });
      trailingDay += 1;
    }
    return out;
  }, [calendarMonth]);

  // Кнопка сброса в системном календаре/часах очищает поле. Трактуем пустое
  // значение как возврат ввода на «сейчас»: иначе форма застревает на ранее
  // подтверждённой дате и вернуться на сегодня из пикера нечем.
  const resetEntryDateTimeToNow = useCallback(() => {
    const now = new Date();
    setDate(normalizeDate(now));
    setTime(normalizeTime(now));
    setTimeTouched(false);
  }, []);

  const submitWorkout = useCallback(async (value: number, selectedType: ExerciseType) => {
    const timeToSend = timeTouched ? time : normalizeTime(new Date());
    const data = await fetchJsonSafe('/api/workouts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reps: value, date, time: toIsoTime(date, timeToSend), exerciseType: selectedType }),
    });
    setInfo(tt('Добавлено'));
    setToastMessage(readWorkoutReward(data)?.message ?? null);
    setTime(normalizeTime(new Date()));
    setTimeTouched(false);
    setReps(0);
    setPlankSecondsLeft(0);
    setPlankTimerActive(false);
    setPlankTimerStarted(false);
    await loadWorkouts();
  }, [date, loadWorkouts, time, timeTouched, tt]);

  const handleAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setInfo(null);
    if (!Number.isFinite(reps) || reps <= 0) {
      setError(isPlankSelected ? tt('Введите корректное количество секунд (> 0)') : 'reps должен быть числом > 0');
      return;
    }

    try {
      await submitWorkout(reps, exerciseType);
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    }
  };

  const handlePlankStart = () => {
    setError(null);
    setInfo(null);
    const target = Math.max(0, reps || 0);
    if (!Number.isFinite(target) || target <= 0) {
      setError(tt('Введите корректное количество секунд (> 0)'));
      return;
    }
    setPlankSecondsLeft(target);
    setPlankTimerStarted(true);
    setPlankTimerActive(true);
  };

  const stopPlankWithActual = useCallback(async (actual: number) => {
    if (!Number.isFinite(actual) || actual <= 0) {
      setPlankTimerActive(false);
      setPlankTimerStarted(false);
      setPlankSecondsLeft(0);
      return;
    }
    setError(null);
    setInfo(null);
    setPlankTimerActive(false);
    setPlankTimerStarted(false);
    try {
      await submitWorkout(actual, 'plank');
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    }
  }, [submitWorkout]);

  const handlePlankStop = useCallback(async () => {
    if (!isPlankSelected) return;
    await stopPlankWithActual(plankElapsedSeconds);
  }, [isPlankSelected, plankElapsedSeconds, stopPlankWithActual]);

  useEffect(() => {
    if (!isPlankSelected || !plankTimerActive || !plankTimerStarted) return;
    const timerId = window.setInterval(() => {
      const currentLeft = plankSecondsLeftRef.current;
      if (currentLeft <= 1) {
        window.clearInterval(timerId);
        setPlankSecondsLeft(0);
        void stopPlankWithActual(repsRef.current);
        return;
      }
      setPlankSecondsLeft(currentLeft - 1);
    }, 1000);
    return () => window.clearInterval(timerId);
  }, [isPlankSelected, plankTimerActive, plankTimerStarted, stopPlankWithActual]);

  function formatClock(totalSeconds: number) {
    const safe = Math.max(0, totalSeconds);
    const mm = Math.floor(safe / 60);
    const ss = safe % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  const startEdit = (w: Workout) => {
    setEditingId(w.id);
    setEditDate(normalizeDate(new Date(w.time || w.date)));
    setEditTime(normalizeTime(new Date(w.time || w.date)));
    setEditReps(w.reps || 0);
    const next = String(w.exerciseType || 'pushups');
    setEditExerciseType(
      next === 'pushups' || next === 'pullups' || next === 'crunches' || next === 'squats' || next === 'plank' ? next : 'pushups',
    );
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setError(null);
    setInfo(null);

    try {
      await fetchJsonSafe('/api/workouts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          reps: editReps,
          date: editDate,
          time: toIsoTime(editDate, editTime),
          exerciseType: editExerciseType,
        }),
      });
      setEditingId(null);
      setInfo(tt('Изменения сохранены'));
      await loadWorkouts();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    }
  };

  const deleteWorkout = async (id: string) => {
    setError(null);
    setInfo(null);
    if (!window.confirm(tt('Удалить эту запись?'))) return;

    try {
      await fetchJsonSafe('/api/workouts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setInfo(tt('Запись удалена'));
      await loadWorkouts();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    }
  };

  const selectedDayData = detailDay ? dayMap.get(detailDay) ?? null : null;
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(tt);
  const todayKey = normalizeDate(new Date());
  const detailsVisible = detailsOpen && Boolean(detailDay && selectedDayData);

  const closeDetails = useCallback(() => {
    setDetailsOpen(false);
    setEditingId(null);
    setWorkoutReactions({});
  }, []);

  useEffect(() => {
    if (!detailsVisible || !selectedDayData?.items?.length) return;
    let cancelled = false;

    const loadReactions = async () => {
      const ids = Array.from(new Set(selectedDayData.items.map((w) => w.id).filter(Boolean)));
      if (!ids.length) return;
      try {
        const data = await fetchJsonSafe(`/api/workout-reactions?ids=${encodeURIComponent(ids.join(','))}`);
        if (cancelled) return;
        setWorkoutReactions(isJsonObject(data) ? (data as Record<string, WorkoutReactionPayload>) : {});
      } catch (error: unknown) {
        if (cancelled) return;
        setError(getErrorMessage(error));
      }
    };

    void loadReactions();
    return () => {
      cancelled = true;
    };
  }, [detailsVisible, selectedDayData]);

  return (
    <div className={`app-page ${styles.page}`}>
      {toastMessage ? <div className="app-toast">{toastMessage}</div> : null}

      <section className={styles.hero}>
        <div className={styles.entryCard}>
          <div className={styles.entryBody}>
            <div style={exerciseTypePickerWrap} role="tablist" aria-label={tt('Упражнение')}>
              {EXERCISE_ORDER.map((type) => {
                const active = exerciseType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleExerciseTypeChange(type)}
                    style={exerciseTypePickerButton(active)}
                    title={tt(exerciseLabel(type))}
                    aria-label={tt(exerciseLabel(type))}
                    aria-pressed={active}
                  >
                    <Image src={exerciseFeedIcon(type)} alt="" aria-hidden="true" width={38} height={38} style={exerciseTypePickerIcon} unoptimized />
                  </button>
                );
              })}
            </div>

            <div
              style={{
                width: '100%',
                maxWidth: 520,
                marginInline: 'auto',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 10,
              }}
            >
              <input
                type="date"
                value={date}
                onChange={(e) => {
                  if (!e.target.value) {
                    resetEntryDateTimeToNow();
                    return;
                  }
                  setDate(e.target.value);
                }}
                style={smallInput}
                aria-label={tt('Дата')}
              />
              <input
                type="time"
                value={time}
                onChange={(e) => {
                  if (!e.target.value) {
                    resetEntryDateTimeToNow();
                    return;
                  }
                  setTime(e.target.value);
                  setTimeTouched(true);
                }}
                style={smallInput}
                aria-label={tt('Время')}
              />

              {/* Сброс внутри системного пикера перехватить нельзя, поэтому,
                  когда ввод уехал с сегодняшнего дня, даём собственный возврат. */}
              {date !== todayKey ? (
                <button type="button" onClick={resetEntryDateTimeToNow} style={resetDateButton}>
                  ↺ {tt('Сегодня')}
                </button>
              ) : null}
            </div>

            <input
              inputMode="numeric"
              value={isPlankSelected && plankTimerStarted ? formatClock(plankSecondsLeft) : String(reps)}
              onChange={(e) => {
                if (isPlankSelected && plankTimerStarted) return;
                const v = e.target.value.replace(/[^\d]/g, '');
                setReps(v === '' ? 0 : Math.min(9999, parseInt(v, 10)));
              }}
              placeholder="0"
              style={repsInputStyle}
              readOnly={isPlankSelected && plankTimerStarted}
            />

            {!plankTimerStarted ? (
              <>
                <div style={plusButtonsGrid}>
                  <button
                    type="button"
                    onClick={() => setReps((prev) => Math.min(9999, (prev || 0) + 5))}
                    style={plus5Button}
                  >
                    {isTimedExercise(exerciseType) ? `+5 ${tt('сек')}` : '+5'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReps((prev) => Math.min(9999, (prev || 0) + 10))}
                    style={plus10Button}
                  >
                    {isTimedExercise(exerciseType) ? `+10 ${tt('сек')}` : '+10'}
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (isPlankSelected) {
                      handlePlankStart();
                      return;
                    }
                    void handleAdd();
                  }}
                  style={addButton}
                >
                  {isPlankSelected ? tt('Старт') : tt('Добавить')}
                </button>
              </>
            ) : (
              <>
                <div style={{ fontSize: 14, fontWeight: 800, color: '#475569' }}>
                  {tt('Сделал')}: {formatExerciseValue(plankElapsedSeconds, 'plank', true)}
                </div>
                <div style={plusButtonsGrid}>
                  <button
                    type="button"
                    onClick={() => setPlankTimerActive((prev) => !prev)}
                    style={plus5Button}
                  >
                    {plankTimerActive ? tt('Пауза') : tt('Продолжить')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handlePlankStop();
                    }}
                    style={plus10Button}
                  >
                    {tt('Стоп')}
                  </button>
                </div>
              </>
            )}
          </div>

          {(error || info) ? (
            <div className={styles.statusStack}>
              {error ? <p className={styles.statusError}>{error}</p> : null}
              {info ? <p className={styles.statusInfo}>{info}</p> : null}
            </div>
          ) : null}
        </div>

        <div className={styles.heroStats}>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{tt('Сегодня')}</div>
            <div className={styles.heroStatValue}>{formatExerciseValue(selectedStats.totalToday, exerciseType, true)}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{tt('Текущая неделя')}</div>
            <div className={styles.heroStatValue}>{formatExerciseValue(selectedStats.totalWeek, exerciseType, true)}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{tt('Серия дней подряд')}</div>
            <div className={styles.heroStatValue}>{stats.streak}</div>
          </div>
        </div>
      </section>

      <section className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleBlock}>
            <h2 className={styles.sectionTitle}>{tt('Всего')}</h2>
          </div>
        </div>

        {initialLoadReady ? (
          <section className="app-tiles">
            <Stat label={tt('Сегодня')} value={stats.totalToday} breakdown={breakdownFromStats((s) => s.totalToday)} />
            <Stat label={tt('Всего')} value={stats.totalAll} breakdown={breakdownFromStats((s) => s.totalAll)} />
            <Stat label={tt('Текущий год')} value={stats.totalYear} breakdown={breakdownFromStats((s) => s.totalYear)} />
            <Stat label={tt('Текущий месяц')} value={stats.totalMonth} breakdown={breakdownFromStats((s) => s.totalMonth)} />
            <Stat label={tt('Текущая неделя')} value={stats.totalWeek} breakdown={breakdownFromStats((s) => s.totalWeek)} />
            <Stat label={tt('Среднее/день (месяц)')} value={stats.avgPerDayMonth || '-'} breakdown={breakdownFromStats((s) => s.avgPerDayMonth)} />
            <Stat label={tt('Среднее/день (год)')} value={stats.avgPerDayYear || '-'} breakdown={breakdownFromStats((s) => s.avgPerDayYear)} />
            <Stat label={tt('Среднее/день (всего)')} value={stats.avgPerDayAll || '-'} breakdown={breakdownFromStats((s) => s.avgPerDayAll)} />
            <Stat label={tt('Серия дней подряд')} value={stats.streak} breakdown={breakdownFromStats((s) => s.streak)} />
          </section>
        ) : (
          <div className={styles.sectionLoading}>{messages.common.loading}</div>
        )}
      </section>

      <section style={card} className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleBlock}>
            <div className={styles.sectionEyebrow}>{messages.common.appName}</div>
            <h2 className={styles.sectionTitle}>{tt('Календарь записей')}</h2>
          </div>
        </div>
        {initialLoadReady ? (
          <>
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
              {weekdays.map((day) => (
                <div key={day} style={calendarWeekdayCell}>{day}</div>
              ))}

              {calendarCells.map((cell) => {
                const row = dayMap.get(cell.key);
                const hasData = Boolean(row && row.items.length);
                const active = detailsOpen && detailDay === cell.key;
                const isToday = cell.key === todayKey;
                const cellDate = new Date(`${cell.key}T00:00:00`);
                const dayOfWeek = cellDate.getDay();
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isOutsideCurrentMonth = !cell.inCurrentMonth;
                const baseBackground = hasData
                  ? (isOutsideCurrentMonth ? 'rgba(248, 250, 252, 0.78)' : '#f8fafc')
                  : (isOutsideCurrentMonth ? 'rgba(248, 250, 252, 0.52)' : '#fff');
                const exerciseTotals = EXERCISE_ORDER
                  .map((type) => ({ type, sum: row?.byExercise.get(type) ?? 0 }))
                  .filter((x) => x.sum > 0);

                return (
                  <button
                    key={cell.key}
                    type="button"
                    onClick={() => {
                      if (!hasData) return;
                      setDetailDay(cell.key);
                      setDetailsOpen(true);
                      setEditingId(null);
                    }}
                    style={{
                      ...calendarDayCell,
                      background: isWeekend
                        ? `linear-gradient(rgba(244, 114, 182, 0.12), rgba(244, 114, 182, 0.12)), ${baseBackground}`
                        : baseBackground,
                      borderColor: isToday
                        ? '#16a34a'
                        : active
                          ? '#2563eb'
                          : hasData
                            ? '#d1d5db'
                            : isOutsideCurrentMonth
                              ? 'rgba(226, 232, 240, 0.72)'
                              : '#f3f4f6',
                      boxShadow: isToday ? 'inset 0 0 0 1px #16a34a' : 'none',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 900,
                        textAlign: 'left',
                        color: isOutsideCurrentMonth ? '#94a3b8' : '#000',
                      }}
                    >
                      {cell.day}
                    </div>
                    <div style={exerciseNumbersRow}>
                      {exerciseTotals.map(({ type, sum }) => (
                        <span key={type} style={exerciseNumberItem}>
                          <Image src={exerciseFeedIcon(type)} alt={tt(exerciseLabel(type))} width={22} height={22} style={exerciseNumberIcon} unoptimized />
                          <span style={exerciseNumber}>{sum}</span>
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={legendWrap}>
              {EXERCISE_ORDER.map((type) => (
                <div key={type} style={legendItem}>
                  <Image src={exerciseFeedIcon(type)} alt={tt(exerciseLabel(type))} width={20} height={20} style={legendIcon} unoptimized />
                  <span>{tt(exerciseLabel(type))}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className={styles.sectionLoading}>{messages.common.loading}</div>
        )}
      </section>

      {detailsVisible ? (
        <div
          style={modalBackdrop}
          onClick={closeDetails}
        >
          <section style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={modalTop}>
              <h2 style={{ margin: 0 }}>{tt('Подходы за день')}</h2>
              <button
                type="button"
                style={btnSecondary}
                onClick={closeDetails}
              >
                {tt('Закрыть')}
              </button>
            </div>

            {!detailDay || !selectedDayData ? (
              <div style={{ color: '#6b7280' }}>{tt('Нет записей на выбранный день.')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: '#111827', fontWeight: 800 }}>
                  {formatDateWithWeekday(detailDay, localeTag)} · {tt('всего')}: {selectedDayData.totalReps}
                </div>

                {selectedDayData.items.map((w) => {
                  const reaction = workoutReactions[w.id];
                  return (
                    <div key={w.id} style={rowCard}>
                      {editingId === w.id ? (
                        <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                          <div style={editGrid}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>{tt('Упражнение')}</label>
                              <select
                                value={editExerciseType}
                                onChange={(e) => setEditExerciseType(e.target.value as ExerciseType)}
                                style={editInput}
                              >
                                <option value="pushups">{tt('Отжимания')}</option>
                                <option value="pullups">{tt('Подтягивания')}</option>
                                <option value="crunches">{tt('Скручивания')}</option>
                                <option value="squats">{tt('Приседания')}</option>
                                <option value="plank">{tt('Планка')}</option>
                              </select>
                            </div>

                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>{tt('Дата')}</label>
                              <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={editInput} />
                            </div>

                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>{tt('Время')}</label>
                              <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} style={editInput} />
                            </div>

                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>{tt(exerciseValueLabel(editExerciseType))}</label>
                              <input
                                type="number"
                                value={editReps}
                                onChange={(e) => setEditReps(Number(e.target.value))}
                                style={editInput}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" onClick={saveEdit} style={btnPrimary}>{tt('Сохранить')}</button>
                            <button type="button" onClick={cancelEdit} style={btnSecondary}>{tt('Отмена')}</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                <Image src={exerciseFeedIcon(w.exerciseType)} alt={tt(exerciseLabel(w.exerciseType))} width={16} height={16} style={detailsExerciseIcon} unoptimized />
                                <span style={{ fontWeight: 800 }}>{tt(exerciseLabel(w.exerciseType))}</span>
                              </div>
                              <div>{tt('Время')}: <b>{formatTimeHHMM(w.time || w.date, localeTag)}</b></div>
                              <div>{tt(exerciseValueLabel(w.exerciseType))}: <b>{formatExerciseValue(w.reps, w.exerciseType, true)}</b></div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => startEdit(w)} style={btnSecondary}>{tt('Редактировать')}</button>
                              <button type="button" onClick={() => deleteWorkout(w.id)} style={btnDanger}>{tt('Удалить')}</button>
                            </div>
                          </div>

                          {reaction?.summary?.length ? (
                            <div style={reactionSummaryRow}>
                              {REACTION_OPTIONS.map((emoji) => {
                                const item = buildReactionSummaryItem(reaction, emoji);
                                if (!item) return null;
                                return (
                                  <span key={`${w.id}-sum-${emoji}`} style={reactionSummaryChip}>
                                    <span>{emoji}</span>
                                    <span style={reactionSummaryCount}>{item.count}</span>
                                    <span style={reactionAvatarsRow}>
                                      {item.avatars.map((r) => (
                                        <span key={`${w.id}-sum-av-${emoji}-${r.id}`} style={reactionAvatarWrap} title={r.username}>
                                          <AvatarMini src={r.avatarPath} />
                                        </span>
                                      ))}
                                      {item.hasMore ? <span style={reactionMoreMark}>+</span> : null}
                                    </span>
                                  </span>
                                );
                              })}
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

const exerciseTypePickerWrap: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
  gap: 'clamp(6px, 1.6vw, 10px)',
  width: '100%',
  maxWidth: 560,
  marginInline: 'auto',
};

function exerciseTypePickerButton(active: boolean): React.CSSProperties {
  return {
    height: 'clamp(52px, 14vw, 62px)',
    borderRadius: 18,
    border: `1px solid ${active ? 'rgba(249, 115, 22, 0.34)' : 'rgba(148, 163, 184, 0.24)'}`,
    background: active
      ? 'linear-gradient(180deg, rgba(255, 237, 213, 0.98) 0%, rgba(255, 247, 237, 0.92) 100%)'
      : 'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.92) 100%)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    boxShadow: active ? '0 16px 28px rgba(249, 115, 22, 0.18)' : '0 10px 20px rgba(15, 23, 42, 0.05)',
    minWidth: 0,
    padding: 0,
  };
}

const exerciseTypePickerIcon: React.CSSProperties = {
  width: 'clamp(24px, 8vw, 38px)',
  height: 'clamp(24px, 8vw, 38px)',
  objectFit: 'contain',
  display: 'block',
};

const statBreakdownWrap: React.CSSProperties = {
  marginTop: 2,
  width: '100%',
  display: 'grid',
  gap: 2,
  alignContent: 'start',
  justifyItems: 'start',
};

const statBreakdownItem: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'clamp(16px, 1.2vw, 20px) auto',
  alignItems: 'center',
  justifyContent: 'start',
  justifyItems: 'start',
  gap: 'clamp(3px, 0.3vw, 6px)',
  minWidth: 0,
  lineHeight: 1,
  width: '100%',
};

const statBreakdownIcon: React.CSSProperties = {
  width: 'clamp(16px, 1.2vw, 20px)',
  height: 'clamp(16px, 1.2vw, 20px)',
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
  justifySelf: 'center',
};

const statBreakdownValue: React.CSSProperties = {
  fontSize: 'clamp(11px, 0.9vw, 15px)',
  fontWeight: 900,
  color: '#0f172a',
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'left',
};

const smallInput: React.CSSProperties = {
  minHeight: 52,
  padding: '10px 14px',
  borderRadius: 18,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.86)',
  textAlign: 'center',
  fontWeight: 700,
  color: '#0f172a',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.76)',
};

const resetDateButton: React.CSSProperties = {
  gridColumn: '1 / -1',
  minHeight: 40,
  padding: '8px 14px',
  borderRadius: 14,
  border: '1px solid rgba(249, 115, 22, 0.28)',
  background: 'rgba(255, 237, 213, 0.72)',
  color: '#c2410c',
  fontWeight: 800,
  fontSize: 13,
  cursor: 'pointer',
};

const repsInputStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
  textAlign: 'center',
  fontWeight: 800,
  fontSize: 'clamp(84px, 20vw, 180px)',
  lineHeight: 1.05,
  padding: '18px 14px',
  borderRadius: 28,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  outline: 'none',
  color: '#0f172a',
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.96) 0%, rgba(248, 250, 252, 0.9) 100%)',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 18px 36px rgba(15, 23, 42, 0.08)',
};

const plusButtonsGrid: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const plusButtonBase: React.CSSProperties = {
  height: 'clamp(72px, 18vw, 130px)',
  width: '100%',
  borderRadius: 22,
  border: '1px solid rgba(255, 255, 255, 0.44)',
  color: '#0f172a',
  fontWeight: 800,
  fontSize: 'clamp(24px, 7vw, 44px)',
  lineHeight: 1,
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
  padding: '0 10px',
  boxShadow: '0 18px 32px rgba(15, 23, 42, 0.08)',
};

const plus5Button: React.CSSProperties = {
  ...plusButtonBase,
  background: 'linear-gradient(135deg, #fde68a 0%, #fbbf24 100%)',
};

const plus10Button: React.CSSProperties = {
  ...plusButtonBase,
  background: 'linear-gradient(135deg, #bbf7d0 0%, #4ade80 100%)',
};

const addButton: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
  minHeight: 60,
  padding: '14px 16px',
  borderRadius: 20,
  border: 'none',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  color: '#fff',
  fontWeight: 800,
  fontSize: 20,
  cursor: 'pointer',
  boxShadow: '0 20px 36px rgba(234, 88, 12, 0.24)',
};

const card: React.CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.86)',
  borderRadius: 30,
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.86) 100%)',
  padding: 'clamp(16px, 3vw, 22px)',
  boxShadow: '0 22px 56px rgba(15, 23, 42, 0.08)',
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
  marginTop: 10,
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

const calendarDayCell: React.CSSProperties = {
  minHeight: 'clamp(82px, 10.5vw, 120px)',
  border: '1px solid rgba(226, 232, 240, 0.9)',
  borderRadius: 18,
  padding: '6px 6px 6px 3px',
  display: 'grid',
  gap: 4,
  alignContent: 'start',
  cursor: 'pointer',
  textAlign: 'left',
  boxShadow: '0 12px 24px rgba(15, 23, 42, 0.04)',
  overflow: 'hidden',
};

const exerciseNumbersRow: React.CSSProperties = {
  display: 'grid',
  gap: 1,
  alignContent: 'start',
  justifyItems: 'start',
  marginLeft: 0,
};

const exerciseNumber: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  fontSize: 'clamp(10px, 0.78vw, 14px)',
  lineHeight: 1,
  fontWeight: 900,
  color: '#000',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const exerciseNumberItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const exerciseNumberIcon: React.CSSProperties = {
  width: 'clamp(12px, 0.95vw, 16px)',
  height: 'clamp(12px, 0.95vw, 16px)',
  objectFit: 'contain',
  flex: '0 0 auto',
  marginLeft: 0,
  marginRight: 1,
};

const legendWrap: React.CSSProperties = {
  marginTop: 10,
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const legendItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 'clamp(6px, 0.4vw, 8px)',
  fontSize: 'clamp(12px, 0.8vw, 14px)',
  fontWeight: 800,
  color: '#000',
};

const legendIcon: React.CSSProperties = {
  width: 'clamp(16px, 1vw, 20px)',
  height: 'clamp(16px, 1vw, 20px)',
  objectFit: 'contain',
  flex: '0 0 auto',
};

const detailsExerciseIcon: React.CSSProperties = {
  width: 16,
  height: 16,
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
};

const miniAvatarWrap: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 999,
  border: '1px solid #d1d5db',
  overflow: 'hidden',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#fff',
  flex: '0 0 auto',
};

const miniAvatarPlaceholder: React.CSSProperties = {
  ...miniAvatarWrap,
};

const reactionSummaryRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const reactionSummaryChip: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  background: 'rgba(255, 255, 255, 0.88)',
  minHeight: 24,
  padding: '0 8px',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 14,
};

const reactionSummaryCount: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  lineHeight: 1,
  color: '#111827',
};

const reactionAvatarsRow: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  marginLeft: 2,
};

const reactionAvatarWrap: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
};

const reactionMoreMark: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#fff',
  fontSize: 11,
  fontWeight: 900,
  color: '#475569',
  lineHeight: 1,
};

const rowCard: React.CSSProperties = {
  border: '1px solid rgba(226, 232, 240, 0.92)',
  borderRadius: 18,
  background: 'rgba(255, 255, 255, 0.92)',
  padding: 12,
  boxShadow: '0 14px 32px rgba(15, 23, 42, 0.05)',
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
  width: 'min(820px, 100%)',
  maxHeight: '88vh',
  overflowY: 'auto',
  border: '1px solid rgba(226, 232, 240, 0.92)',
  borderRadius: 24,
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.98) 0%, rgba(248, 250, 252, 0.94) 100%)',
  padding: 18,
  boxShadow: '0 30px 80px rgba(15, 23, 42, 0.18)',
};

const modalTop: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
  flexWrap: 'wrap',
};

const editGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 8,
};

const editInput: React.CSSProperties = {
  minHeight: 44,
  padding: '8px 10px',
  borderRadius: 12,
  border: '1px solid rgba(148, 163, 184, 0.3)',
  background: '#fff',
};

const btnPrimary: React.CSSProperties = {
  padding: '11px 14px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
  boxShadow: '0 16px 28px rgba(234, 88, 12, 0.22)',
};

const btnSecondary: React.CSSProperties = {
  padding: '11px 14px',
  borderRadius: 14,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.88)',
  cursor: 'pointer',
  fontWeight: 800,
  color: '#0f172a',
};

const btnDanger: React.CSSProperties = {
  padding: '11px 14px',
  borderRadius: 14,
  border: 'none',
  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};
