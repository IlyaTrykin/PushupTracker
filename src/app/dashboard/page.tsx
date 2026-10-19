'use client';

import Image from 'next/image';
import { mediaUrl } from '@/lib/platform';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { formatDayPointsTotal } from '@/i18n/messages/features/points';
import { getIntlLocale, t } from '@/i18n/translate';
import { exerciseValueLabel, formatCalendarDayValue, formatDistance, formatDuration, formatExerciseValue, isTimedExercise, formatWorkoutValue } from '@/lib/exercise-metrics';
import { formatDurationTyping, parseDistanceKm, parseDurationInput } from '@/lib/workout-input';
import { cardioMessages } from '@/i18n/messages/features/cardio';
import { getStoredExerciseType, persistExerciseType, subscribeExerciseType, type ExerciseType } from '@/lib/exercise-type-store';
import { EXERCISE_ORDER, createByExercise, exerciseIcon, exerciseLabel as catalogExerciseLabel, getExercise, toExerciseType } from '@/lib/exercises';
import { useExerciseLoad } from '@/lib/use-exercise-load';
import { useFavoriteExercises } from '@/lib/use-favorite-exercises';
import SideLoadEntry, { WeightPicker } from './SideLoadEntry';
import RepCounterButtons from './RepCounterButtons';
import { repCounterMessages } from '@/i18n/messages/features/rep-counter';
import { useStopwatch } from '@/lib/use-stopwatch';
import { computePeriodStats, dayPointsTotal, localTodayKey, streakFreezeMessages, workoutDayKey, type PeriodStats } from '@/lib/day-stats';
import {
  buildQueueEditPatch,
  queueEntryState,
  queueErrorKind,
  resolveEntryMoment,
  unsentNotice,
  type OutboxItem,
  type QueueEntryState,
} from '@/lib/offline/outbox-core';
import { localHHMM, zonedTimeToInstant } from '@/lib/calendar-day';
import { OUTBOX_FLUSHED_EVENT, OUTBOX_ITEM_SENT_EVENT, outboxPausedUntil, type FlushResult, type OutboxFlushedDetail, type OutboxItemSentDetail } from '@/lib/offline/sync';
import { OutboxBusyError, useOutbox } from '@/lib/offline/use-outbox';
import { offlineOutboxMessages } from '@/i18n/messages/features/offline-outbox';
import { installHealthSync, removeWorkoutFromHealth, syncWorkoutToHealth } from '@/lib/health/health';
import { healthExternalId } from '@/lib/health/reconcile';
import { recommendToday } from '@/lib/recommendation';
import DailyGoalRing from '@/components/DailyGoalRing';
import TodayRecommendation from '@/components/TodayRecommendation';
import RecordToast, { readCelebration, type Celebration } from '@/components/RecordToast';
import ShareCardSheet, { ShareButton } from '@/components/ShareCardSheet';
import { MIN_SHARE_STREAK, type ShareCardInput } from '@/lib/share-card';
import styles from './dashboard.module.css';

type Workout = {
  id: string;
  reps: number;
  loadKg?: number | null;
  repsLeft?: number | null;
  repsRight?: number | null;
  durationSeconds?: number | null;
  date: string;
  time?: string;
  exerciseType?: string;
  clientRequestId?: string | null;
  /** Set for an entry of the offline outbox that is not on the server yet (or «будет удалена»). */
  queueStatus?: QueueEntryState;
  /** Why it is not accepted, or why it keeps waiting after several failed tries. */
  queueError?: string | null;
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
  /** «Всего за день» в баллах (B27). */
  totalPoints: number;
};

type Stats = PeriodStats;

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

const REACTION_OPTIONS = ['👍', '🔥', '👎', '💩'] as const;
const WORKOUTS_CACHE_VERSION = '20260327-1';

/** `HH:MM` of `date` on the user's wall clock (`timeZone`) as an ISO instant. */
function zonedIsoTime(date: string, time: string, timeZone: string) {
  return zonedTimeToInstant(date, time, timeZone).toISOString();
}

function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** The user's saved zone (as the server counts days), the browser's while it is unknown. */
function entryTimeZone(saved: string | null | undefined): string {
  if (saved) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: saved }).resolvedOptions().timeZone;
    } catch {}
  }
  return browserTimeZone();
}

/** An outbox entry shown in the lists and counted in the day like a server record. */
function queuedWorkout(item: OutboxItem): Workout {
  const p = item.payload;
  const { state, reason } = queueEntryState(item);
  return {
    id: item.id,
    reps: p.reps,
    loadKg: p.loadKg ?? null,
    repsLeft: p.repsLeft ?? null,
    repsRight: p.repsRight ?? null,
    durationSeconds: p.durationSeconds ?? null,
    date: p.date,
    time: p.time,
    exerciseType: p.exerciseType,
    clientRequestId: p.clientRequestId,
    queueStatus: state,
    queueError: reason,
  };
}

/** Not part of the day's numbers: refused by the server, or deleted and waiting to be deleted there. */
function isUncounted(w: Workout): boolean {
  return w.queueStatus === 'rejected' || w.queueStatus === 'deleting';
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
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

function formatTimeHHMM(iso: string | undefined, locale: string, timeZone?: string) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  try {
    return dt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', ...(timeZone ? { timeZone } : {}) });
  } catch {
    return dt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
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

// Пустые значения в статистике: ноль и прочерки средних без данных.
function hasBreakdownValue(value: number | string | undefined) {
  if (value == null) return false;
  if (typeof value === 'number') return value !== 0;
  const trimmed = value.trim();
  return trimmed !== '' && trimmed !== '-' && trimmed !== '—' && Number(trimmed) !== 0;
}

function Stat({ label, value, breakdown, locale, metric = true }: { label: string; value: number | string; breakdown?: StatBreakdown; locale: string; metric?: boolean }) {
  // В плитке — только упражнения, по которым за период есть записи.
  const breakdownTypes = breakdown ? EXERCISE_ORDER.filter((type) => hasBreakdownValue(breakdown[type])) : [];
  return (
    <div className={`app-tile${breakdown ? ' app-tile--breakdown' : ''}`}>
      <div className="app-tile__title">{label}</div>
      {!breakdown ? <div className="app-tile__value">{value}</div> : null}
      {breakdown ? (
        <div style={statBreakdownWrap}>
          {breakdownTypes.length ? breakdownTypes.map((type) => (
            <span key={`${label}-${type}`} style={statBreakdownItem}>
              <Image src={exerciseFeedIcon(type)} alt="" aria-hidden="true" width={20} height={20} style={statBreakdownIcon} unoptimized />
              <span style={statBreakdownValue}>{metric ? formatExerciseValue(breakdown[type], type, true, locale).replace(/ (сек|sec)$/, '') : breakdown[type]}</span>
            </span>
          )) : (
            <span style={statBreakdownValue}>—</span>
          )}
        </div>
      ) : null}
    </div>
  );
}

function normalizeExerciseType(type: string | undefined): ExerciseType {
  return toExerciseType(type);
}

function exerciseFeedIcon(type: string | undefined) {
  return exerciseIcon(type);
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
      <Image src={mediaUrl(src) ?? src} alt="" width={14} height={14} unoptimized style={{ width: 14, height: 14, objectFit: 'cover', display: 'block' }} />
    </span>
  );
}

export default function DashboardPage() {
  const { user, refreshUser } = useAuth();
  const { locale, messages } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const exerciseType = useSyncExternalStore<ExerciseType>(subscribeExerciseType, getStoredExerciseType, () => 'pushups');
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  const [date, setDate] = useState<string>(normalizeDate(new Date()));
  // An untouched day is «today» at the moment of saving (in the user's zone), not when the page opened.
  const [dateTouched, setDateTouched] = useState(false);
  const [time, setTime] = useState<string>(normalizeTime(new Date()));
  const [timeTouched, setTimeTouched] = useState(false);
  const [reps, setReps] = useState<number>(0);
  // Длительность подхода, посчитанного камерой / касанием (уходит с тренировкой, в т. ч. в Health).
  const [countedDuration, setCountedDuration] = useState<number | null>(null);
  const [distanceKm, setDistanceKm] = useState('');
  const [durationText, setDurationText] = useState('');
  const cardio = cardioMessages[locale];
  // Ключ исторический (секундомер был только у планки) — не меняем, чтобы не потерять идущий замер.
  const timedStopwatch = useStopwatch('dashboardPlankStopwatch');
  const activeExercise = getExercise(exerciseType);
  const exerciseLoad = useExerciseLoad(exerciseType);
  const [repsLeft, setRepsLeft] = useState(0);
  const [repsRight, setRepsRight] = useState(0);
  const { favorites: favoriteExercises } = useFavoriteExercises();
  const [moreExercisesOpen, setMoreExercisesOpen] = useState(false);
  const isFavoriteSelected = favoriteExercises.includes(exerciseType);

  useEffect(() => {
    if (!moreExercisesOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreExercisesOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [moreExercisesOpen]);
  const otherExercises = useMemo(
    () => EXERCISE_ORDER.filter((type) => !favoriteExercises.includes(type)),
    [favoriteExercises],
  );

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  // F3: «Новый рекорд подхода!» / «Рекорд дня!» / new badges from the POST response.
  const [celebration, setCelebration] = useState<Celebration | null>(null);
  const closeCelebration = useCallback(() => setCelebration(null), []);
  const [shareInput, setShareInput] = useState<ShareCardInput | null>(null);
  const closeShare = useCallback(() => setShareInput(null), []);
  // «Добавить» заблокирована, пока запись кладётся в очередь. Сама отправка — из офлайн-очереди
  // с постоянным clientRequestId: повтор после обрыва сети не создаёт дубль (B04, R11.1).
  const [adding, setAdding] = useState(false);
  const addingRef = useRef(false);
  const outbox = useOutbox();
  const queueText = offlineOutboxMessages[locale];
  // `lastError` of a failed try in words: no connection, no answer in time, server error, or the server's text.
  const queueReasonText = (reason: string) => {
    const kind = queueErrorKind(reason);
    if (kind === 'network') return queueText.reasonNetwork;
    if (kind === 'timeout') return queueText.reasonTimeout;
    if (kind === 'server') return queueText.reasonServer.replace('{status}', reason.replace(/^HTTP /, ''));
    return reason;
  };
  // The entry just saved from the form: its answer from the server shows the reward and records.
  const awaitingSendRef = useRef<string | null>(null);
  // Older queued entries sent along with it: one «Workouts sent: N» after the flush.
  const backlogSentRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>(normalizeDate(new Date()));
  const [editTime, setEditTime] = useState<string>(normalizeTime(new Date()));
  const [editReps, setEditReps] = useState<number>(0);
  const [editExerciseType, setEditExerciseType] = useState<ExerciseType>('pushups');
  const [editDistanceKm, setEditDistanceKm] = useState('');
  const [editDurationText, setEditDurationText] = useState('');
  const [editRepsLeft, setEditRepsLeft] = useState(0);
  const [editRepsRight, setEditRepsRight] = useState(0);
  const [editLoadKg, setEditLoadKg] = useState<number | null>(null);

  const [calendarMonth, setCalendarMonth] = useState<Date>(() => monthStart(new Date()));
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [detailDay, setDetailDay] = useState<string | null>(null);
  const [workoutReactions, setWorkoutReactions] = useState<Record<string, WorkoutReactionPayload>>({});
  const [initialLoadReady, setInitialLoadReady] = useState(false);
  const isTimedSelected = activeExercise.unit === 'seconds';
  const isDistanceSelected = activeExercise.unit === 'distance';
  const timerStarted = isTimedSelected && timedStopwatch.started;
  const workoutsCacheKey = useMemo(
    () => getWorkoutsCacheKey(user?.id, user?.username),
    [user?.id, user?.username],
  );

  const handleExerciseTypeChange = (next: ExerciseType) => {
    // Замер принадлежит выбранному упражнению: при смене упражнения он сбрасывается.
    if (next !== exerciseType) {
      timedStopwatch.reset();
      setCountedDuration(null);
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

  // «Сегодня» — по сохранённому поясу пользователя, как на сервере; браузерный — пока он не загружен.
  const todayKey = localTodayKey(user?.timeZone);
  const entryZone = entryTimeZone(user?.timeZone);

  // Server records + entries still on the device (story 17). An entry that already reached the
  // server but is still in the queue (answer lost) is shown once, by its clientRequestId.
  // An entry «будет удалена» stands for its server record too (it is deleted there once online).
  const allWorkouts = useMemo(() => {
    const deleting = new Set(outbox.items.filter((item) => item.deleteOnServer).map((item) => item.id));
    const server = deleting.size ? workouts.filter((w) => !w.clientRequestId || !deleting.has(w.clientRequestId)) : workouts;
    const onServer = new Set(server.map((w) => w.clientRequestId).filter(Boolean));
    const queued = outbox.items.filter((item) => !onServer.has(item.id)).map(queuedWorkout);
    return queued.length ? [...server, ...queued] : server;
  }, [outbox.items, workouts]);
  // Rejected entries are listed for fixing, deleted ones until the server confirms; neither counts.
  const countedWorkouts = useMemo(() => allWorkouts.filter((w) => !isUncounted(w)), [allWorkouts]);
  const firstRejected = useMemo(() => outbox.items.find((item) => item.status === 'rejected' && !item.deleteOnServer) ?? null, [outbox.items]);

  const stats = useMemo(() => computePeriodStats(countedWorkouts, todayKey), [countedWorkouts, todayKey]);

  // Daily goal (F1) and «Рекомендация на сегодня» (F12): the user's day by the saved zone.
  useEffect(() => {
    void refreshUser(); // fresh goal and active programs after visiting the profile or programs
  }, [refreshUser]);
  const userDayKey = todayKey;
  const userDayPoints = useMemo(
    () => dayPointsTotal(countedWorkouts.filter((w) => workoutDayKey(w) === userDayKey)),
    [countedWorkouts, userDayKey],
  );
  const activeProgramExercises = user?.activeProgramExercises;
  const showRecommendation = Array.isArray(activeProgramExercises) && !activeProgramExercises.includes(exerciseType);
  const todayRecommendation = useMemo(
    () => (showRecommendation ? recommendToday(countedWorkouts, exerciseType, userDayKey) : null),
    [countedWorkouts, exerciseType, showRecommendation, userDayKey],
  );
  const statsByExercise = useMemo<Record<ExerciseType, Stats>>(
    () => createByExercise((type) => computePeriodStats(countedWorkouts.filter((w) => normalizeExerciseType(w.exerciseType) === type), todayKey)),
    [countedWorkouts, todayKey],
  );
  const freezeText = streakFreezeMessages[locale];
  const streakBreakdown: StatBreakdown = createByExercise((type) => {
    const s = statsByExercise[type];
    return s.streakFreezeUsed ? `${s.streak} ${freezeText.badge}` : s.streak;
  });

  const breakdownFromStats = (pick: (s: Stats) => number): StatBreakdown =>
    createByExercise((type) => pick(statsByExercise[type]));
  const selectedStats = statsByExercise[exerciseType];

  const dayMap = useMemo(() => {
    const map = new Map<string, DayAggregate>();
    allWorkouts.forEach((w) => {
      const key = workoutDayKey(w);
      const row = map.get(key) || { items: [], byExercise: new Map<string, number>(), totalPoints: 0 };
      row.items.push(w);
      if (!isUncounted(w)) {
        const t = normalizeExerciseType(w.exerciseType);
        row.byExercise.set(t, (row.byExercise.get(t) ?? 0) + (w.reps || 0));
      }
      map.set(key, row);
    });

    for (const row of map.values()) {
      row.totalPoints = dayPointsTotal(row.items.filter((w) => !isUncounted(w)));
      row.items.sort((a, b) => new Date(b.time || b.date).getTime() - new Date(a.time || a.date).getTime());
    }

    return map;
  }, [allWorkouts]);

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

  // Легенда календаря — только упражнения, которые есть в показанном месяце.
  const calendarTypes = useMemo(
    () => EXERCISE_ORDER.filter((type) => calendarCells.some((cell) => (dayMap.get(cell.key)?.byExercise.get(type) ?? 0) > 0)),
    [calendarCells, dayMap],
  );

  // Кнопка сброса в системном календаре/часах очищает поле. Трактуем пустое
  // значение как возврат ввода на «сейчас»: иначе форма застревает на ранее
  // подтверждённой дате и вернуться на сегодня из пикера нечем.
  const resetEntryDateTimeToNow = useCallback(() => {
    const now = new Date();
    setDate(normalizeDate(now));
    setDateTouched(false);
    setTime(normalizeTime(now));
    setTimeTouched(false);
  }, []);

  const rateLimitedText = useCallback(() => {
    const until = user?.id ? outboxPausedUntil(user.id) : null;
    return queueText.rateLimited.replace('{time}', until ? until.toLocaleTimeString(localeTag, { hour: '2-digit', minute: '2-digit' }) : '—');
  }, [localeTag, queueText, user?.id]);

  // What the form says when its entry did not get an answer in this flush: «no connection» only
  // when there is none; a busy queue with a live network — «queued for sending» (story 55).
  const reportUnsent = useCallback((result: Pick<FlushResult, 'stopped' | 'retryReason'>) => {
    const notice = unsentNotice(result, !isOffline());
    if (notice === 'rate-limited') setInfo(rateLimitedText());
    else if (notice === 'unauthorized') setError(queueText.unauthorized);
    else if (notice === 'queued') setInfo(queueText.savedQueued);
    else if (notice === 'server') setInfo(queueText.serverUnavailable);
    else setInfo(queueText.savedOffline);
  }, [queueText, rateLimitedText]);

  // Новая тренировка всегда сначала ложится в очередь на устройстве (с днём и временем записи)
  // и сразу пытается уйти; ответ сервера (награда, рекорды) приходит событием из очереди.
  const submitWorkout = useCallback(async (
    value: number,
    selectedType: ExerciseType,
    extra: { loadKg?: number | null; repsLeft?: number; repsRight?: number; durationSeconds?: number } = {},
  ) => {
    const moment = resolveEntryMoment({ date, time, dateTouched, timeTouched }, new Date(), entryZone);
    const item = await outbox.enqueue({ reps: value, ...extra, date: moment.date, time: moment.time, exerciseType: selectedType });
    awaitingSendRef.current = item.id;
    // Apple Health / Health Connect: written at once, also offline (app only, when switched on).
    void syncWorkoutToHealth(item.payload, user?.id);
    setTime(normalizeTime(new Date()));
    setTimeTouched(false);
    setReps(0);
    setCountedDuration(null);
    setDistanceKm('');
    setDurationText('');
    setRepsLeft(0);
    setRepsRight(0);
    void outbox.flush().then((result) => {
      if (awaitingSendRef.current !== item.id) return; // answered: handled by the sent event
      awaitingSendRef.current = null;
      reportUnsent(result);
    });
  }, [date, dateTouched, entryZone, outbox, reportUnsent, time, timeTouched, user?.id]);

  // Health reconcile at app start, on resume and after the queue went out (app only, when on).
  useEffect(() => {
    if (user?.id) installHealthSync(user.id);
  }, [user?.id]);

  // Answers from the server for queued entries (this tab's flushes and the background timer).
  useEffect(() => {
    const userId = user?.id;
    if (!userId) return;
    const onSent = (event: Event) => {
      const detail = (event as CustomEvent<OutboxItemSentDetail>).detail;
      if (!detail || detail.userId !== userId) return;
      const { outcome } = detail;
      const created = outcome.kind === 'created' || outcome.kind === 'replayed';
      if (created) {
        // Show the record at once instead of a gap until the list reloads.
        const data = 'response' in outcome ? outcome.response : null;
        const record = isJsonObject(data) && isJsonObject(data.workout) ? (data.workout as Workout) : null;
        if (record?.id) setWorkouts((prev) => (prev.some((w) => w.id === record.id) ? prev : [record, ...prev]));
      }
      if (detail.id !== awaitingSendRef.current) {
        if (created) backlogSentRef.current += 1;
        return;
      }
      awaitingSendRef.current = null;
      if (created) {
        const data = 'response' in outcome ? outcome.response : null;
        setInfo(tt('Добавлено'));
        setToastMessage(readWorkoutReward(data)?.message ?? null);
        setCelebration(readCelebration(data));
      } else if (outcome.kind === 'rejected') {
        setError(`${queueText.rejectedBadge}: ${outcome.message}`);
      } else if (outcome.kind === 'rate-limited') {
        setInfo(rateLimitedText());
      } else if (outcome.kind === 'unauthorized') {
        setError(queueText.unauthorized);
      } else if (outcome.kind === 'retry') {
        reportUnsent({ stopped: 'offline', retryReason: outcome.reason });
      }
    };
    const onFlushed = (event: Event) => {
      const detail = (event as CustomEvent<OutboxFlushedDetail>).detail;
      if (!detail || detail.userId !== userId) return;
      // Lists and totals after the queue went out (story 25); one line for entries made earlier.
      if (backlogSentRef.current > 0) setInfo(queueText.sentCount.replace('{count}', String(detail.sent)));
      backlogSentRef.current = 0;
      void loadWorkouts();
    };
    window.addEventListener(OUTBOX_ITEM_SENT_EVENT, onSent);
    window.addEventListener(OUTBOX_FLUSHED_EVENT, onFlushed);
    return () => {
      window.removeEventListener(OUTBOX_ITEM_SENT_EVENT, onSent);
      window.removeEventListener(OUTBOX_FLUSHED_EVENT, onFlushed);
    };
  }, [loadWorkouts, queueText, rateLimitedText, reportUnsent, tt, user?.id]);

  // Один запрос за раз: повторное нажатие, пока запрос в пути, игнорируется.
  const runAdd = async (task: () => Promise<void>) => {
    if (addingRef.current) return;
    addingRef.current = true;
    setAdding(true);
    try {
      await task();
    } catch (error: unknown) {
      setError(getErrorMessage(error));
    } finally {
      addingRef.current = false;
      setAdding(false);
    }
  };

  const handleAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (addingRef.current) return;
    setError(null);
    setInfo(null);
    if (activeExercise.unilateral) {
      const total = repsLeft + repsRight;
      if (total <= 0) {
        setError(tt(isTimedSelected ? 'Введите корректное количество секунд (> 0)' : 'Укажите повторы хотя бы для одной руки'));
        return;
      }
      await runAdd(() => submitWorkout(total, exerciseType, { loadKg: exerciseLoad.loadKg, repsLeft, repsRight }));
      return;
    }
    if (isDistanceSelected) {
      const distance = parseDistanceKm(distanceKm);
      if (!distance.ok) {
        setError(cardioMessages[locale].distanceInvalid);
        return;
      }
      const duration = parseDurationInput(durationText);
      if (!duration.ok) {
        setError(cardioMessages[locale].durationInvalid);
        return;
      }
      await runAdd(() => submitWorkout(distance.value, exerciseType, duration.value != null ? { durationSeconds: duration.value } : {}));
      return;
    }
    if (!Number.isFinite(reps) || reps <= 0) {
      setError(isTimedSelected ? tt('Введите корректное количество секунд (> 0)') : 'reps должен быть числом > 0');
      return;
    }

    // Длительность от RepCounter только показывается: сервер хранит её лишь у дистанции.
    await runAdd(() => submitWorkout(reps, exerciseType, activeExercise.load ? { loadKg: exerciseLoad.loadKg } : {}));
  };

  const handleTimerStart = () => {
    setError(null);
    setInfo(null);
    timedStopwatch.start();
  };

  const handleTimerStop = async () => {
    if (addingRef.current) return;
    const actual = timedStopwatch.finish();
    if (actual <= 0) return;
    setError(null);
    setInfo(null);
    await runAdd(() => submitWorkout(actual, exerciseType));
  };

  function formatClock(totalSeconds: number) {
    const safe = Math.max(0, totalSeconds);
    const mm = Math.floor(safe / 60);
    const ss = safe % 60;
    return `${mm}:${String(ss).padStart(2, '0')}`;
  }

  const startEdit = (w: Workout) => {
    setEditingId(w.id);
    setEditDate(workoutDayKey(w));
    // The form shows the user's wall clock (the zone days are counted in), and saves in it.
    setEditTime(localHHMM(new Date(w.time || w.date), entryZone));
    setEditReps(w.reps || 0);
    setEditRepsLeft(w.repsLeft ?? 0);
    setEditRepsRight(w.repsRight ?? 0);
    setEditLoadKg(w.loadKg ?? null);
    setEditExerciseType(normalizeExerciseType(w.exerciseType));
    setEditDistanceKm(getExercise(w.exerciseType).unit === 'distance' ? formatDistance(w.reps || 0, 'en').replace(/ km$/, '') : '');
    setEditDurationText(w.durationSeconds ? formatDuration(w.durationSeconds) : '');
  };

  const cancelEdit = () => {
    setEditingId(null);
  };

  // B13: смена упражнения — поля нагрузки приводятся к новому упражнению.
  const changeEditExerciseType = (next: ExerciseType) => {
    const prev = getExercise(editExerciseType);
    const target = getExercise(next);
    if (prev.unilateral && !target.unilateral) {
      setEditReps(editRepsLeft + editRepsRight || editReps);
    } else if (!prev.unilateral && target.unilateral && editRepsLeft + editRepsRight === 0) {
      setEditRepsLeft(editReps);
      setEditRepsRight(0);
    }
    if (target.unit === 'distance' && prev.unit !== 'distance') {
      setEditDistanceKm('');
      setEditDurationText('');
    }
    if (!target.load) setEditLoadKg(null);
    else if (editLoadKg == null) setEditLoadKg(target.load.referenceKg);
    setEditExerciseType(next);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setError(null);
    setInfo(null);
    if (getExercise(editExerciseType).unilateral && editRepsLeft + editRepsRight <= 0) {
      setError(tt(isTimedExercise(editExerciseType) ? 'Введите корректное количество секунд (> 0)' : 'Укажите повторы хотя бы для одной руки'));
      return;
    }

    let distancePatch: { reps: number; durationSeconds: number | null } | null = null;
    if (getExercise(editExerciseType).unit === 'distance') {
      const distance = parseDistanceKm(editDistanceKm);
      const duration = parseDurationInput(editDurationText);
      if (!distance.ok || !duration.ok) {
        setError(!distance.ok ? cardioMessages[locale].distanceInvalid : cardioMessages[locale].durationInvalid);
        return;
      }
      distancePatch = { reps: distance.value, durationSeconds: duration.value };
    }

    // An entry still on the device: the change goes into the queue (story 19).
    if (allWorkouts.some((w) => w.id === editingId && w.queueStatus)) {
      const patch = buildQueueEditPatch(
        {
          exerciseType: editExerciseType,
          date: editDate,
          time: editTime,
          reps: editReps,
          repsLeft: editRepsLeft,
          repsRight: editRepsRight,
          loadKg: editLoadKg,
          distance: distancePatch,
        },
        entryZone,
      );
      try {
        await outbox.update(editingId, patch);
        void syncWorkoutToHealth({
          clientRequestId: editingId,
          exerciseType: editExerciseType,
          reps: patch.reps ?? 0,
          durationSeconds: patch.durationSeconds ?? null,
          time: patch.time ?? zonedIsoTime(editDate, editTime, entryZone),
          date: patch.date ?? editDate,
          loadKg: patch.loadKg ?? null,
          repsLeft: patch.repsLeft ?? null,
          repsRight: patch.repsRight ?? null,
        }, user?.id);
        setEditingId(null);
        setInfo(queueText.queueUpdated);
        void outbox.flush();
      } catch (error: unknown) {
        setError(error instanceof OutboxBusyError ? queueText.inFlight : getErrorMessage(error));
      }
      return;
    }
    // A record on the server is changed only online.
    if (isOffline()) {
      setError(queueText.needConnection);
      return;
    }

    const editedOriginal = workouts.find((w) => w.id === editingId);
    try {
      const updated = await fetchJsonSafe('/api/workouts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingId,
          ...(distancePatch
            ? distancePatch
            : getExercise(editExerciseType).unilateral
              ? { repsLeft: editRepsLeft, repsRight: editRepsRight }
              : { reps: editReps }),
          ...(editLoadKg != null && getExercise(editExerciseType).load ? { loadKg: editLoadKg } : {}),
          date: editDate,
          time: zonedIsoTime(editDate, editTime, entryZone),
          exerciseType: editExerciseType,
        }),
      });
      if (isJsonObject(updated) && typeof updated.id === 'string') {
        const record = updated as Workout;
        void syncWorkoutToHealth({
          clientRequestId: healthExternalId({ id: record.id, clientRequestId: editedOriginal?.clientRequestId ?? null }),
          exerciseType: record.exerciseType ?? editExerciseType,
          reps: record.reps,
          durationSeconds: record.durationSeconds ?? null,
          time: record.time ?? zonedIsoTime(editDate, editTime, entryZone),
          date: record.date ? record.date.slice(0, 10) : editDate,
          loadKg: record.loadKg ?? null,
          repsLeft: record.repsLeft ?? null,
          repsRight: record.repsRight ?? null,
          // Калории, пересчитанные сервером после правки (R01.5).
          activeKcal: (updated as { activeKcal?: number | null }).activeKcal ?? null,
        }, user?.id);
      }
      setEditingId(null);
      setInfo(tt('Изменения сохранены'));
      await loadWorkouts();
    } catch (error: unknown) {
      setError(error instanceof TypeError ? queueText.needConnection : getErrorMessage(error));
    }
  };

  const deleteWorkout = async (id: string) => {
    setError(null);
    setInfo(null);
    if (!window.confirm(tt('Удалить эту запись?'))) return;

    if (allWorkouts.some((w) => w.id === id && w.queueStatus)) {
      try {
        // It may already be on the server: then «будет удалена» until the server deletes it (story 50).
        const removed = await outbox.remove(id);
        void removeWorkoutFromHealth(id, user?.id);
        setInfo(removed === 'deleting' ? queueText.queueDeleting : queueText.queueRemoved);
      } catch (error: unknown) {
        setError(error instanceof OutboxBusyError ? queueText.inFlight : getErrorMessage(error));
      }
      return;
    }
    if (isOffline()) {
      setError(queueText.needConnection);
      return;
    }

    const deletedRecord = workouts.find((w) => w.id === id);
    try {
      await fetchJsonSafe('/api/workouts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      void removeWorkoutFromHealth(healthExternalId({ id, clientRequestId: deletedRecord?.clientRequestId ?? null }), user?.id);
      setInfo(tt('Запись удалена'));
      await loadWorkouts();
    } catch (error: unknown) {
      setError(error instanceof TypeError ? queueText.needConnection : getErrorMessage(error));
    }
  };

  const selectedDayData = detailDay ? dayMap.get(detailDay) ?? null : null;
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(tt);
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
      const ids = Array.from(new Set(selectedDayData.items.filter((w) => !w.queueStatus).map((w) => w.id).filter(Boolean)));
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
      {celebration && !toastMessage ? (
        <RecordToast celebration={celebration} locale={locale === 'en' ? 'en' : 'ru'} onClose={closeCelebration} onShare={setShareInput} />
      ) : null}
      <ShareCardSheet input={shareInput} onClose={closeShare} />

      <section className={styles.hero}>
        <div className={styles.entryCard}>
          {outbox.pendingCount > 0 || outbox.deletingCount > 0 || firstRejected ? (
            <div style={queueRow} role="status">
              {outbox.pendingCount > 0 ? (
                <span style={queuePill}>⏳ {queueText.pendingCounter.replace('{count}', String(outbox.pendingCount))}</span>
              ) : null}
              {outbox.deletingCount > 0 ? (
                <span style={queuePill}>🗑 {queueText.deletingCounter.replace('{count}', String(outbox.deletingCount))}</span>
              ) : null}
              {firstRejected ? (
                <button
                  type="button"
                  style={queuePillRejected}
                  onClick={() => {
                    setDetailDay(firstRejected.payload.date);
                    setDetailsOpen(true);
                    setEditingId(null);
                  }}
                >
                  ⚠ {queueText.rejectedCounter.replace('{count}', String(outbox.rejectedCount))}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className={styles.entryBody}>
            <div style={exerciseTypePickerWrap} role="tablist" aria-label={tt('Упражнение')}>
              {favoriteExercises.map((type) => {
                const active = exerciseType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleExerciseTypeChange(type)}
                    style={exerciseTypePickerButton(active)}
                    title={catalogExerciseLabel(type, locale)}
                    aria-label={catalogExerciseLabel(type, locale)}
                    aria-pressed={active}
                  >
                    <Image src={exerciseFeedIcon(type)} alt="" aria-hidden="true" width={38} height={38} style={exerciseTypePickerIcon} unoptimized />
                  </button>
                );
              })}

              {/* Пятая кнопка — быстрый доступ ко всем остальным упражнениям без
                  перенастройки избранного. Если выбрано упражнение не из избранного,
                  кнопка показывает его, чтобы было видно, что сейчас активно. */}
              <button
                type="button"
                onClick={() => setMoreExercisesOpen((prev) => !prev)}
                style={exerciseTypePickerButton(!isFavoriteSelected)}
                title={messages.favoriteExercises.more}
                aria-label={messages.favoriteExercises.more}
                aria-expanded={moreExercisesOpen}
                aria-haspopup="true"
              >
                {isFavoriteSelected ? (
                  <span style={moreExercisesGlyph} aria-hidden="true">⋯</span>
                ) : (
                  <span style={moreExercisesSelected}>
                    <Image src={exerciseFeedIcon(exerciseType)} alt="" aria-hidden="true" width={38} height={38} style={moreExercisesSelectedIcon} unoptimized />
                    <span style={moreExercisesSelectedGlyph} aria-hidden="true">⋯</span>
                  </span>
                )}
              </button>

              {moreExercisesOpen ? (
                <>
                  <div style={moreExercisesBackdrop} onClick={() => setMoreExercisesOpen(false)} aria-hidden="true" />
                  <div style={moreExercisesMenu} role="menu" aria-label={messages.favoriteExercises.more}>
                    {otherExercises.length ? otherExercises.map((type) => (
                      <button
                        key={type}
                        type="button"
                        role="menuitemradio"
                        aria-checked={exerciseType === type}
                        onClick={() => {
                          handleExerciseTypeChange(type);
                          setMoreExercisesOpen(false);
                        }}
                        style={moreExercisesItem(exerciseType === type)}
                      >
                        <Image src={exerciseFeedIcon(type)} alt="" aria-hidden="true" width={30} height={30} unoptimized />
                        <span>{catalogExerciseLabel(type, locale)}</span>
                      </button>
                    )) : (
                      <div style={moreExercisesEmpty}>{messages.favoriteExercises.empty}</div>
                    )}
                  </div>
                </>
              ) : null}
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
                value={dateTouched ? date : todayKey}
                onChange={(e) => {
                  if (!e.target.value) {
                    resetEntryDateTimeToNow();
                    return;
                  }
                  setDate(e.target.value);
                  setDateTouched(true);
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
              {dateTouched && date !== todayKey ? (
                <button type="button" onClick={resetEntryDateTimeToNow} style={resetDateButton}>
                  ↺ {tt('Сегодня')}
                </button>
              ) : null}
            </div>

            {activeExercise.unilateral ? (
              // Упражнения на одну руку: вес снаряда и повторы отдельно для каждой руки.
              <>
                <SideLoadEntry
                  exercise={activeExercise}
                  locale={locale}
                  tt={tt}
                  loadKg={exerciseLoad.loadKg}
                  onLoadKgChange={exerciseLoad.setLoadKg}
                  repsLeft={repsLeft}
                  repsRight={repsRight}
                  onRepsLeftChange={setRepsLeft}
                  onRepsRightChange={setRepsRight}
                />
                <button type="button" onClick={() => void handleAdd()} style={adding ? addButtonBusy : addButton} disabled={adding} aria-busy={adding}>
                  {tt('Добавить')}
                </button>
              </>
            ) : null}

            {isDistanceSelected ? (
              // Кардио: дистанция в км и необязательное время; секундомера и «+5» нет.
              <div style={cardioEntryWrap}>
                <label style={cardioLabel}>
                  {cardio.distanceLabel}
                  <input
                    inputMode="decimal"
                    value={distanceKm}
                    onChange={(e) => setDistanceKm(e.target.value.replace(/[^\d.,]/g, '').slice(0, 7))}
                    placeholder={cardio.distancePlaceholder}
                    style={cardioDistanceInput}
                    aria-label={cardio.distanceLabel}
                  />
                </label>
                <label style={cardioLabel}>
                  {cardio.durationLabel}
                  <input
                    inputMode="numeric"
                    value={durationText}
                    onChange={(e) => setDurationText(formatDurationTyping(e.target.value))}
                    placeholder={cardio.durationPlaceholder}
                    style={cardioDurationInput}
                    aria-label={cardio.durationLabel}
                  />
                </label>
                <button type="button" onClick={() => void handleAdd()} style={adding ? addButtonBusy : addButton} disabled={adding} aria-busy={adding}>
                  {tt('Добавить')}
                </button>
              </div>
            ) : null}

            {!activeExercise.unilateral && !isDistanceSelected ? (
            <>
            {activeExercise.load ? (
              <WeightPicker
                exercise={activeExercise}
                locale={locale}
                tt={tt}
                loadKg={exerciseLoad.loadKg}
                onLoadKgChange={exerciseLoad.setLoadKg}
              />
            ) : null}
            <input
              inputMode="numeric"
              value={timerStarted ? formatClock(timedStopwatch.elapsedSeconds) : String(reps)}
              onChange={(e) => {
                if (timerStarted) return;
                const v = e.target.value.replace(/[^\d]/g, '');
                setReps(v === '' ? 0 : Math.min(9999, parseInt(v, 10)));
                if (v === '') setCountedDuration(null);
              }}
              placeholder="0"
              style={repsInputStyle}
              readOnly={timerStarted}
            />

            {!timerStarted ? (
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

                {!isTimedSelected ? (
                  <RepCounterButtons
                    exerciseType={exerciseType}
                    locale={locale}
                    disabled={adding}
                    onCounted={(count, seconds) => {
                      setError(null);
                      setInfo(null);
                      setReps(count);
                      setCountedDuration(seconds);
                    }}
                  />
                ) : null}
                {countedDuration && !isTimedSelected ? (
                  <div style={countedDurationNote}>
                    ⏱ {repCounterMessages[locale].durationNote.replace('{duration}', formatDuration(countedDuration))}
                  </div>
                ) : null}

                {isTimedSelected ? (
                  // Секундомер для упражнений на время: замер «сколько простоял»; ручной
                  // ввод остаётся для записи прошедшего подхода. Обратный отсчёт — в программе.
                  <div style={timerActionsGrid}>
                    <button type="button" onClick={handleTimerStart} style={timerStartButton}>
                      ▶ {tt('Старт')}
                    </button>
                    <button type="button" onClick={() => void handleAdd()} style={adding ? addButtonBusy : addButton} disabled={adding} aria-busy={adding}>
                      {tt('Добавить')}
                    </button>
                  </div>
                ) : (
                  <button type="button" onClick={() => void handleAdd()} style={adding ? addButtonBusy : addButton} disabled={adding} aria-busy={adding}>
                    {tt('Добавить')}
                  </button>
                )}
              </>
            ) : (
              <>
                <div style={plusButtonsGrid}>
                  <button
                    type="button"
                    onClick={timedStopwatch.running ? timedStopwatch.pause : timedStopwatch.resume}
                    style={plus5Button}
                  >
                    {timedStopwatch.running ? messages.programSession.rest.pause : messages.programSession.rest.resume}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleTimerStop();
                    }}
                    style={plus10Button}
                    disabled={adding}
                  >
                    {tt('Стоп')}
                  </button>
                </div>
              </>
            )}
            </>
            ) : null}
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
            <div className={styles.heroStatValue}>{formatExerciseValue(selectedStats.totalToday, exerciseType, true, locale)}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{tt('Текущая неделя')}</div>
            <div className={styles.heroStatValue}>{formatExerciseValue(selectedStats.totalWeek, exerciseType, true, locale)}</div>
          </div>
          <div className={styles.heroStat}>
            <div className={styles.heroStatLabel}>{tt('Серия дней подряд')}</div>
            <div className={styles.heroStatValue}>
              {stats.streak}
              {stats.streakFreezeUsed ? (
                <span title={freezeText.hint} aria-label={freezeText.hint} style={freezeBadge}> {freezeText.badge}</span>
              ) : null}
            </div>
            {stats.streakFreezeUsed ? <div style={freezeCaption}>{freezeText.short}</div> : null}
            {stats.streak >= MIN_SHARE_STREAK ? (
              <div style={streakShare}>
                <ShareButton input={{ kind: 'streak', days: stats.streak }} iconOnly />
              </div>
            ) : null}
          </div>
        </div>

        {initialLoadReady && (user?.dailyGoalPoints !== undefined || showRecommendation) ? (
          <div className={styles.todayRow}>
            <DailyGoalRing donePoints={userDayPoints} goalPoints={user?.dailyGoalPoints} locale={locale} />
            {showRecommendation ? (
              <TodayRecommendation
                recommendation={todayRecommendation}
                exerciseName={catalogExerciseLabel(exerciseType, locale)}
                locale={locale}
              />
            ) : null}
          </div>
        ) : null}
      </section>

      <section className={styles.sectionCard}>
        <div className={styles.sectionHeader}>
          <div className={styles.sectionTitleBlock}>
            <h2 className={styles.sectionTitle}>{tt('Всего')}</h2>
          </div>
        </div>

        {initialLoadReady ? (
          <section className="app-tiles">
            <Stat label={tt('Сегодня')} value={stats.totalToday} breakdown={breakdownFromStats((s) => s.totalToday)} locale={locale} />
            <Stat label={tt('Всего')} value={stats.totalAll} breakdown={breakdownFromStats((s) => s.totalAll)} locale={locale} />
            <Stat label={tt('Текущий год')} value={stats.totalYear} breakdown={breakdownFromStats((s) => s.totalYear)} locale={locale} />
            <Stat label={tt('Текущий месяц')} value={stats.totalMonth} breakdown={breakdownFromStats((s) => s.totalMonth)} locale={locale} />
            <Stat label={tt('Текущая неделя')} value={stats.totalWeek} breakdown={breakdownFromStats((s) => s.totalWeek)} locale={locale} />
            <Stat label={tt('Среднее/день (месяц)')} value={stats.avgPerDayMonth || '-'} breakdown={breakdownFromStats((s) => s.avgPerDayMonth)} locale={locale} />
            <Stat label={tt('Среднее/день (год)')} value={stats.avgPerDayYear || '-'} breakdown={breakdownFromStats((s) => s.avgPerDayYear)} locale={locale} />
            <Stat label={tt('Среднее/день (всего)')} value={stats.avgPerDayAll || '-'} breakdown={breakdownFromStats((s) => s.avgPerDayAll)} locale={locale} />
            <Stat label={tt('Серия дней подряд')} value={stats.streak} breakdown={streakBreakdown} locale={locale} metric={false} />
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
                          <Image src={exerciseFeedIcon(type)} alt={catalogExerciseLabel(type, locale)} width={22} height={22} style={exerciseNumberIcon} unoptimized />
                          <span style={exerciseNumber}>{formatCalendarDayValue(sum, type, locale)}</span>
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>

            <div style={legendWrap}>
              {calendarTypes.map((type) => (
                <div key={type} style={legendItem}>
                  <Image src={exerciseFeedIcon(type)} alt={catalogExerciseLabel(type, locale)} width={20} height={20} style={legendIcon} unoptimized />
                  <span>{catalogExerciseLabel(type, locale)}</span>
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
                  {formatDateWithWeekday(detailDay, localeTag)} · {formatDayPointsTotal(selectedDayData.totalPoints, locale)}
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
                                onChange={(e) => changeEditExerciseType(e.target.value as ExerciseType)}
                                style={editInput}
                              >
                                {EXERCISE_ORDER.map((type) => (
                                  <option key={type} value={type}>{catalogExerciseLabel(type, locale)}</option>
                                ))}
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

                            {getExercise(editExerciseType).unilateral ? (
                              <>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <label>{tt('Левая')}</label>
                                  <input type="number" value={editRepsLeft} onChange={(e) => setEditRepsLeft(Number(e.target.value))} style={editInput} />
                                </div>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <label>{tt('Правая')}</label>
                                  <input type="number" value={editRepsRight} onChange={(e) => setEditRepsRight(Number(e.target.value))} style={editInput} />
                                </div>
                              </>
                            ) : getExercise(editExerciseType).unit === 'distance' ? (
                              <>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <label>{cardio.distanceLabel}</label>
                                  <input inputMode="decimal" value={editDistanceKm} onChange={(e) => setEditDistanceKm(e.target.value.replace(/[^\d.,]/g, ''))} style={editInput} />
                                </div>
                                <div style={{ display: 'grid', gap: 4 }}>
                                  <label>{cardio.durationLabel}</label>
                                  <input inputMode="numeric" value={editDurationText} onChange={(e) => setEditDurationText(formatDurationTyping(e.target.value))} placeholder={cardio.durationPlaceholder} style={editInput} />
                                </div>
                              </>
                            ) : (
                              <div style={{ display: 'grid', gap: 4 }}>
                                <label>{tt(exerciseValueLabel(editExerciseType))}</label>
                                <input
                                  type="number"
                                  value={editReps}
                                  onChange={(e) => setEditReps(Number(e.target.value))}
                                  style={editInput}
                                />
                              </div>
                            )}

                            {editLoadKg != null ? (
                              <div style={{ display: 'grid', gap: 4 }}>
                                <label>{tt('Вес')}, {tt('кг')}</label>
                                <input type="number" step="0.5" value={editLoadKg} onChange={(e) => setEditLoadKg(Number(e.target.value))} style={editInput} />
                              </div>
                            ) : null}
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
                                <Image src={exerciseFeedIcon(w.exerciseType)} alt={catalogExerciseLabel(w.exerciseType, locale)} width={16} height={16} style={detailsExerciseIcon} unoptimized />
                                <span style={{ fontWeight: 800 }}>{catalogExerciseLabel(w.exerciseType, locale)}</span>
                              </div>
                              {w.queueStatus ? (
                                <div style={w.queueStatus === 'rejected' ? queueBadgeRejected : queueBadge}>
                                  {w.queueStatus === 'rejected'
                                    ? `${queueText.rejectedBadge}${w.queueError ? `: ${w.queueError}` : ''}. ${queueText.rejectedHint}`
                                    : w.queueStatus === 'deleting'
                                      ? `${queueText.deletingBadge}${w.queueError ? `: ${queueReasonText(w.queueError)}` : ''}`
                                      : `${w.queueStatus === 'sending' ? queueText.sendingBadge : queueText.pendingBadge}${w.queueError ? `: ${queueReasonText(w.queueError)}` : ''}`}
                                </div>
                              ) : null}
                              <div>{tt('Время')}: <b>{formatTimeHHMM(w.time || w.date, localeTag, entryZone)}</b></div>
                              <div>{getExercise(w.exerciseType).unit === 'distance' ? cardioMessages[locale].valueLabel : tt(exerciseValueLabel(w.exerciseType))}: <b>{formatWorkoutValue(w, locale)}</b></div>
                            </div>

                            {w.queueStatus === 'deleting' ? null : (
                              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                <button type="button" onClick={() => startEdit(w)} style={btnSecondary}>{tt('Редактировать')}</button>
                                <button type="button" onClick={() => deleteWorkout(w.id)} style={btnDanger}>{tt('Удалить')}</button>
                              </div>
                            )}
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

const queueRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  justifyContent: 'center',
  marginBottom: 10,
};

const queuePill: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 10px',
  borderRadius: 999,
  background: '#fef3c7',
  color: '#92400e',
  fontSize: 13,
  fontWeight: 700,
};

const queuePillRejected: React.CSSProperties = {
  ...queuePill,
  background: '#fee2e2',
  color: '#991b1b',
  border: 'none',
  cursor: 'pointer',
};

const queueBadge: React.CSSProperties = {
  justifySelf: 'start',
  padding: '2px 8px',
  borderRadius: 999,
  background: '#fef3c7',
  color: '#92400e',
  fontSize: 12,
  fontWeight: 700,
};

const queueBadgeRejected: React.CSSProperties = {
  ...queueBadge,
  background: '#fee2e2',
  color: '#991b1b',
  borderRadius: 10,
};

const exerciseTypePickerWrap: React.CSSProperties = {
  position: 'relative',
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

const moreExercisesGlyph: React.CSSProperties = {
  fontSize: 'clamp(24px, 7vw, 32px)',
  fontWeight: 900,
  lineHeight: 1,
  color: '#475569',
};

const moreExercisesSelected: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 0,
  lineHeight: 1,
};

// Иконка чуть меньше соседних, чтобы под ней поместилось «⋯» — намёк на выбор.
const moreExercisesSelectedIcon: React.CSSProperties = {
  width: 'clamp(20px, 6.5vw, 30px)',
  height: 'clamp(20px, 6.5vw, 30px)',
  objectFit: 'contain',
  display: 'block',
};

const moreExercisesSelectedGlyph: React.CSSProperties = {
  marginTop: -2,
  fontSize: 'clamp(14px, 4vw, 18px)',
  fontWeight: 900,
  lineHeight: 0.8,
  color: '#64748b',
};

const moreExercisesBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 20,
};

const moreExercisesMenu: React.CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 8px)',
  right: 0,
  zIndex: 21,
  width: 'min(280px, 100%)',
  maxHeight: '60vh',
  overflowY: 'auto',
  display: 'grid',
  gap: 6,
  padding: 8,
  borderRadius: 20,
  border: '1px solid rgba(148, 163, 184, 0.28)',
  background: 'rgba(255, 255, 255, 0.98)',
  boxShadow: '0 24px 48px rgba(15, 23, 42, 0.18)',
};

function moreExercisesItem(active: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    padding: '8px 12px',
    borderRadius: 14,
    border: `1px solid ${active ? 'rgba(249, 115, 22, 0.34)' : 'transparent'}`,
    background: active ? 'rgba(255, 237, 213, 0.9)' : 'transparent',
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 800,
    textAlign: 'left',
    cursor: 'pointer',
  };
}

const moreExercisesEmpty: React.CSSProperties = {
  padding: '10px 12px',
  color: '#64748b',
  fontSize: 13,
};

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

const cardioEntryWrap: React.CSSProperties = { display: 'grid', gap: 12, width: '100%', maxWidth: 520, marginInline: 'auto' };
const cardioLabel: React.CSSProperties = { display: 'grid', gap: 6, fontWeight: 700, color: '#475569', fontSize: 14 };
const cardioDistanceInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'center',
  fontWeight: 800,
  fontSize: 'clamp(48px, 14vw, 96px)',
  lineHeight: 1.1,
  padding: '14px 12px',
  borderRadius: 28,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  outline: 'none',
  color: '#0f172a',
  background: '#fff',
};
const cardioDurationInput: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  textAlign: 'center',
  fontWeight: 700,
  fontSize: 28,
  padding: '12px 12px',
  borderRadius: 20,
  border: '1px solid rgba(148, 163, 184, 0.26)',
  outline: 'none',
  color: '#0f172a',
  background: '#fff',
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

const countedDurationNote: React.CSSProperties = {
  textAlign: 'center',
  fontSize: 14,
  fontWeight: 600,
  color: '#475569',
  fontVariantNumeric: 'tabular-nums',
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

const addButtonBusy: React.CSSProperties = {
  ...addButton,
  opacity: 0.6,
  cursor: 'progress',
};

const freezeBadge: React.CSSProperties = {
  fontSize: '0.8em',
  cursor: 'help',
};

const streakShare: React.CSSProperties = { justifySelf: 'center' };

const freezeCaption: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: '#0369a1',
  marginTop: 2,
};

const timerActionsGrid: React.CSSProperties = {
  width: '100%',
  maxWidth: 520,
  marginInline: 'auto',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const timerStartButton: React.CSSProperties = {
  ...addButton,
  background: 'linear-gradient(135deg, #14b8a6 0%, #0d9488 100%)',
  boxShadow: '0 20px 36px rgba(13, 148, 136, 0.24)',
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

// Numbers and icons scale with the day cell (container query units), so they fit a phone-width cell.
const exerciseNumbersRow: React.CSSProperties = {
  display: 'grid',
  gap: 1,
  alignContent: 'start',
  justifyItems: 'start',
  marginLeft: 0,
  containerType: 'inline-size',
  minWidth: 0,
};

const exerciseNumber: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  fontSize: 'clamp(8px, 26cqi, 14px)',
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
  width: 'clamp(9px, 28cqi, 16px)',
  height: 'clamp(9px, 28cqi, 16px)',
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
