'use client';

import Image from 'next/image';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';
import { formatExerciseValue } from '@/lib/exercise-metrics';

interface Friend {
  friendshipId: string;
  userId: string;
  username: string;
  email: string | null;
  avatarPath?: string | null;
  since: string;
  isFollowing?: boolean;
}

interface PendingRequest {
  friendshipId: string;
  userId: string;
  username: string;
  email: string | null;
  avatarPath?: string | null;
  createdAt: string;
}


function AvatarCircle({ src, size = 28 }: { src?: string | null; size?: number }) {
  const base: React.CSSProperties = {
    width: size,
    height: size,
    borderRadius: 9999,
    flex: `0 0 ${size}px`,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    background: '#fff',
    border: '1px solid #e5e7eb',
  };

  if (!src) return <span aria-hidden="true" style={base} />;

  // src может содержать ?t=... для bust cache — оставляем как есть
  return (
    <span style={base}>
      <Image src={src} alt="" width={size} height={size} unoptimized style={{ width: size, height: size, objectFit: 'cover', display: 'block' }} />
    </span>
  );
}


type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';

interface Workout {
  id: string;
  reps: number;
  date: string;          // ISO date
  time?: string | null;  // ISO datetime (если есть)
  exerciseType?: ExerciseType;
}

type FeedWorkoutItem = Workout & {
  ownerUsername: string;
  ownerAvatarPath: string | null;
  isMe: boolean;
  occurredAt: number;
};

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

type Stats = {
  totalToday: number;
  totalAll: number;
  totalWeek: number;
  totalMonth: number;
  totalYear: number;
  avgPerDayMonth: number;
  avgPerDayYear: number;
  avgPerDayAll: number;
  streak: number;
};

type StatsByExercise = Record<ExerciseType, Stats>;

type SortDir = 'asc' | 'desc';
type SortKey =
  | 'username'
  | 'today'
  | 'all'
  | 'year'
  | 'month'
  | 'week'
  | 'avgMonth'
  | 'avgYear'
  | 'avgAll'
  | 'streak';

type FeedLimit = 5 | 10 | 30 | 50 | 100;
type JsonObject = Record<string, unknown>;
type MeSummary = { id: string; username: string; avatarPath: string | null };
type FriendRequestsPayload = { incoming: PendingRequest[]; outgoing: PendingRequest[] };
type FriendStatsRow = {
  friend: Friend;
  statsAll: Stats;
  statsByExercise: StatsByExercise;
};
type TableRow = {
  isMe: boolean;
  friend: Pick<Friend, 'friendshipId' | 'username' | 'avatarPath' | 'isFollowing'>;
  statsAll: Stats;
  statsByExercise: StatsByExercise;
};

const EXERCISE_ORDER: ExerciseType[] = ['pushups', 'pullups', 'crunches', 'squats', 'plank'];
const REACTION_OPTIONS = ['👍', '🔥', '👎', '💩'] as const;
const FEED_LIMIT_OPTIONS: FeedLimit[] = [5, 10, 30, 50, 100];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

function getWorkoutDate(value: Pick<Workout, 'time' | 'date'>): Date {
  return new Date(value.time || value.date);
}

function getWorkoutTimestamp(value: Pick<Workout, 'time' | 'date'>): number {
  return getWorkoutDate(value).getTime();
}

function normalizeDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function addCalendarMonths(base: Date, delta: number): Date {
  return new Date(base.getFullYear(), base.getMonth() + delta, 1);
}

function formatMonthTitle(date: Date, locale: string): string {
  return date.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

function formatDateWithWeekday(dayKey: string, locale: string): string {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function exerciseNumberColor(type: ExerciseType): string {
  if (type === 'pushups') return '#38bdf8';
  if (type === 'pullups') return '#ef4444';
  if (type === 'crunches') return '#22c55e';
  if (type === 'squats') return '#b8860b';
  return '#14b8a6';
}

function exerciseLabel(type: ExerciseType): string {
  if (type === 'pushups') return 'Отжимания';
  if (type === 'pullups') return 'Подтягивания';
  if (type === 'crunches') return 'Скручивания';
  if (type === 'squats') return 'Приседания';
  return 'Планка';
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const normalized = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function exerciseFeedIcon(type: ExerciseType): string {
  const v = '20260315-2';
  if (type === 'pushups') return `/icons/exercise-types/feed/pushups.svg?v=${v}`;
  if (type === 'pullups') return `/icons/exercise-types/feed/pullups.svg?v=${v}`;
  if (type === 'crunches') return `/icons/exercise-types/feed/crunches.svg?v=${v}`;
  if (type === 'squats') return `/icons/exercise-types/feed/squats.svg?v=${v}`;
  return `/icons/exercise-types/feed/plank.svg?v=${v}`;
}

function toExerciseType(type: string | undefined): ExerciseType {
  if (type === 'pullups' || type === 'crunches' || type === 'squats' || type === 'plank') return type;
  return 'pushups';
}

function calcStats(workouts: Workout[]): Stats {
  const byDay = new Map<string, number>();

  for (const w of workouts) {
    const dt = getWorkoutDate(w);
    const key = normalizeDate(dt);
    byDay.set(key, (byDay.get(key) ?? 0) + (w.reps || 0));
  }

  const msDay = 86400000;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // календарная неделя с понедельника
  const dow = today.getDay(); // 0=вс
  const offsetToMon = (dow + 6) % 7;
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - offsetToMon);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const yearStart = new Date(today.getFullYear(), 0, 1);

  const todayKey = normalizeDate(today);
  const totalToday = byDay.get(todayKey) ?? 0;

  let totalAll = 0;
  let totalWeek = 0;
  let totalMonth = 0;
  let totalYear = 0;

  for (const [k, sum] of byDay.entries()) {
    totalAll += sum;
    const [y, m, d] = k.split('-').map(Number);
    const dayDate = new Date(y, (m || 1) - 1, d || 1);

    if (dayDate >= weekStart && dayDate <= today) totalWeek += sum;
    if (dayDate >= monthStart && dayDate <= today) totalMonth += sum;
    if (dayDate >= yearStart && dayDate <= today) totalYear += sum;
  }

  const daysMonth = Math.floor((today.getTime() - monthStart.getTime()) / msDay) + 1;
  const daysYear = Math.floor((today.getTime() - yearStart.getTime()) / msDay) + 1;

  const avgPerDayMonth = daysMonth > 0 ? Math.round(totalMonth / daysMonth) : 0;
  const avgPerDayYear = daysYear > 0 ? Math.round(totalYear / daysYear) : 0;

  // среднее/день (всего): от первого дня до сегодня
  let avgPerDayAll = 0;
  if (byDay.size > 0 && totalAll > 0) {
    const daysAsc = Array.from(byDay.keys()).sort();
    const [fy, fm, fd] = daysAsc[0].split('-').map(Number);
    const first = new Date(fy, (fm || 1) - 1, fd || 1);
    const daysAll = Math.floor((today.getTime() - first.getTime()) / msDay) + 1;
    avgPerDayAll = daysAll > 0 ? Math.round(totalAll / daysAll) : 0;
  }

  // серия дней подряд
  let streak = 0;
  const daysDesc = Array.from(byDay.keys()).sort().reverse();
  if (daysDesc.length > 0) {
    const [ly, lm, ld] = daysDesc[0].split('-').map(Number);
    let cursor = new Date(ly, (lm || 1) - 1, ld || 1);

    while (true) {
      const key = normalizeDate(cursor);
      if (byDay.has(key)) {
        streak += 1;
        cursor = new Date(cursor.getTime() - msDay);
      } else break;
    }
  }

  return {
    totalToday,
    totalAll,
    totalWeek,
    totalMonth,
    totalYear,
    avgPerDayMonth,
    avgPerDayYear,
    avgPerDayAll,
    streak,
  };
}

function calcStatsByExercise(workouts: Workout[]): StatsByExercise {
  return {
    pushups: calcStats(workouts.filter((w) => toExerciseType(w.exerciseType) === 'pushups')),
    pullups: calcStats(workouts.filter((w) => toExerciseType(w.exerciseType) === 'pullups')),
    crunches: calcStats(workouts.filter((w) => toExerciseType(w.exerciseType) === 'crunches')),
    squats: calcStats(workouts.filter((w) => toExerciseType(w.exerciseType) === 'squats')),
    plank: calcStats(workouts.filter((w) => toExerciseType(w.exerciseType) === 'plank')),
  };
}

function formatTimeHHMM(iso?: string | null) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
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

async function fetchJson(url: string) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
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

export default function FriendsPage() {
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<PendingRequest[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<PendingRequest[]>([]);
  const [me, setMe] = useState<{ id: string; username: string; avatarPath: string | null } | null>(null);
  const [newUsername, setNewUsername] = useState('');

  // сортировка: null => режим по умолчанию (Ты сверху + друзья по алфавиту)
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [showAddFriendForm, setShowAddFriendForm] = useState(false);

  const [selectedFriend, setSelectedFriend] = useState<string>(''); // username
  const selectedFriendObj = useMemo(() => friends.find((f) => f.username === selectedFriend) || null, [friends, selectedFriend]);
  const [friendCalendarMonth, setFriendCalendarMonth] = useState<Date>(() => monthStart(new Date()));
  const [friendDetailsOpen, setFriendDetailsOpen] = useState(false);
  const [friendDetailDay, setFriendDetailDay] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [myWorkouts, setMyWorkouts] = useState<Workout[]>([]);
  const [friendWorkouts, setFriendWorkouts] = useState<Record<string, Workout[]>>({});
  const [friendWorkoutReactions, setFriendWorkoutReactions] = useState<Record<string, WorkoutReactionPayload>>({});
  const [reactingWorkoutId, setReactingWorkoutId] = useState<string | null>(null);
  const [modalReactionPickerWorkoutId, setModalReactionPickerWorkoutId] = useState<string | null>(null);
  const [feedReactionPickerWorkoutId, setFeedReactionPickerWorkoutId] = useState<string | null>(null);
  const [feedLimit, setFeedLimit] = useState<FeedLimit>(5);
  const [feedViewportHeight, setFeedViewportHeight] = useState<number | null>(null);
  const feedListRef = useRef<HTMLDivElement | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const meData = (await fetchJson('/api/me')) as MeSummary;
      setMe(meData || null);

      const mine = (await fetchJson('/api/workouts')) as Workout[];
      setMyWorkouts(mine || []);

      const fr = (await fetchJson('/api/friends')) as Friend[];
      setFriends(fr || []);

      const req = (await fetchJson('/api/friends/requests')) as FriendRequestsPayload;
      setIncomingRequests(req?.incoming || []);
      setOutgoingRequests(req?.outgoing || []);

      const byUser = (await fetchJson('/api/friends/workouts')) as Record<string, Workout[]>;
      setFriendWorkouts((byUser && typeof byUser === 'object') ? byUser : {});
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const loadFriendWorkoutReactions = useCallback(async (workoutIds: string[]) => {
    const ids = Array.from(new Set(workoutIds.filter(Boolean)));
    if (!ids.length) {
      return;
    }

    try {
      const data = await fetchJson(`/api/workout-reactions?ids=${encodeURIComponent(ids.join(','))}`);
      if (data && typeof data === 'object') {
        setFriendWorkoutReactions((prev) => ({ ...prev, ...data }));
      }
    } catch (e) {
      setError(getErrorMessage(e));
    }
  }, []);

  // Авто-выбор друга в выпадающем меню
  useEffect(() => {
    if (!friends || friends.length === 0) {
      setSelectedFriend('');
      return;
    }
    const exists = friends.some((f) => f.username === selectedFriend);
    if (!selectedFriend || !exists) setSelectedFriend(friends[0].username);
  }, [friends, selectedFriend]);

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const username = newUsername.trim();
    if (!username) {
      setError(tt('Введите ник друга'));
      return;
    }

    try {
      const res = await fetch('/api/friends', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ username }),
      });

      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try { data = JSON.parse(text); } catch {}
      }

      if (!res.ok) {
        const base = isJsonObject(data) && typeof data.error === 'string' ? data.error : `Ошибка добавления друга (код ${res.status})`;
        const details = isJsonObject(data) && typeof data.details === 'string' ? data.details : '';
        throw new Error(details ? `${base}: ${details}` : base);
      }

      setNewUsername('');
      const responseUsername = isJsonObject(data) && typeof data.username === 'string' ? data.username : username;
      setInfo(tt(`Запрос отправлен пользователю ${responseUsername}`));
      await loadAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleRespondRequest = async (friendshipId: string, action: 'accept' | 'decline') => {
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action, friendshipId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const base = data?.error || `Ошибка действия (код ${res.status})`;
        const details = data?.details || '';
        throw new Error(details ? `${base}: ${details}` : base);
      }
      setInfo(tt(action === 'accept' ? 'Запрос в друзья принят' : 'Запрос отклонён'));
      await loadAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleCancelOutgoing = async (friendshipId: string, username: string) => {
    const ok = window.confirm(tt(`Отменить запрос в друзья пользователю ${username}?`));
    if (!ok) return;
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ friendshipId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const base = data?.error || `Ошибка отмены (код ${res.status})`;
        const details = data?.details || '';
        throw new Error(details ? `${base}: ${details}` : base);
      }
      setInfo(tt('Исходящий запрос отменён'));
      await loadAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleToggleFollow = async (row: Friend, follow: boolean) => {
    setError(null);
    setInfo(null);
    try {
      const res = await fetch('/api/friends', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ action: 'follow', friendshipId: row.friendshipId, follow }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const base = data?.error || `Ошибка подписки (код ${res.status})`;
        const details = data?.details || '';
        throw new Error(details ? `${base}: ${details}` : base);
      }
      setFriends((prev) => prev.map((f) => (f.friendshipId === row.friendshipId ? { ...f, isFollowing: follow } : f)));
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleRemoveFriend = async (friendshipId: string, username: string) => {
    const ok = window.confirm(tt(`Удалить пользователя ${username} из друзей?`));
    if (!ok) return;

    setError(null);
    setInfo(null);

    try {
      const res = await fetch('/api/friends', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ friendshipId }),
      });

      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try { data = JSON.parse(text); } catch {}
      }

      if (!res.ok) {
        const base = isJsonObject(data) && typeof data.error === 'string' ? data.error : `Ошибка удаления друга (код ${res.status})`;
        const details = isJsonObject(data) && typeof data.details === 'string' ? data.details : '';
        throw new Error(details ? `${base}: ${details}` : base);
      }

      setInfo(tt(`Пользователь ${username} удалён из друзей`));
      await loadAll();
    } catch (e) {
      setError(getErrorMessage(e));
    }
  };

  const handleFriendWorkoutReaction = async (workoutId: string, emoji: string) => {
    setError(null);
    try {
      setReactingWorkoutId(workoutId);

      const res = await fetch('/api/workout-reactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workoutId, emoji }),
      });

      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {}
      }

      if (!res.ok) {
        const base = isJsonObject(data) && typeof data.error === 'string' ? data.error : `Ошибка реакции (код ${res.status})`;
        throw new Error(base);
      }

      if (isJsonObject(data) && data.workoutId === workoutId && data.reaction) {
        setFriendWorkoutReactions((prev) => ({ ...prev, [workoutId]: data.reaction as WorkoutReactionPayload }));
      }
      setModalReactionPickerWorkoutId(null);
      setFeedReactionPickerWorkoutId(null);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setReactingWorkoutId(null);
    }
  };

  const myStatsAll = useMemo(() => calcStats(myWorkouts), [myWorkouts]);
  const myStatsByExercise = useMemo(() => calcStatsByExercise(myWorkouts), [myWorkouts]);

  const friendRows = useMemo<FriendStatsRow[]>(() => {
    return friends.map((f) => {
      const raw = friendWorkouts[f.username] || [];
      const statsAll = calcStats(raw);
      const statsByExercise = calcStatsByExercise(raw);
      return { friend: f, statsAll, statsByExercise };
    });
  }, [friends, friendWorkouts]);

  const meRow = useMemo<TableRow>(() => {
    return {
      friend: {
        username: 'Ты',
        friendshipId: '__me__',
        avatarPath: me?.avatarPath ?? null,
        isFollowing: false,
      },
      statsAll: myStatsAll,
      statsByExercise: myStatsByExercise,
      isMe: true,
    };
  }, [myStatsAll, myStatsByExercise, me?.avatarPath]);

  // Режим по умолчанию: Ты сверху + друзья по алфавиту
  const defaultSorted = useMemo<TableRow[]>(() => {
    const sortedFriends = [...friendRows].sort((a, b) =>
      (a.friend.username || '').localeCompare(b.friend.username || '', 'ru', { sensitivity: 'base' })
    );

    return [
      meRow,
      ...sortedFriends.map((x) => ({ ...x, isMe: false })),
    ];
  }, [friendRows, meRow]);

  // Сортировка по колонке: сортируются ВСЕ строки, включая "Ты"
  const sortedAll = useMemo<TableRow[]>(() => {
    if (!sortKey) return defaultSorted;

    const all: TableRow[] = [
      meRow,
      ...friendRows.map((x) => ({ ...x, isMe: false })),
    ];

    const getVal = (row: TableRow, key: SortKey): string | number => {
      const s: Stats = row.statsAll;
      const uname = row.isMe ? 'Ты' : row.friend.username;

      switch (key) {
        case 'username': return uname || '';
        case 'today': return s.totalToday ?? 0;
        case 'all': return s.totalAll ?? 0;
        case 'year': return s.totalYear ?? 0;
        case 'month': return s.totalMonth ?? 0;
        case 'week': return s.totalWeek ?? 0;
        case 'avgMonth': return s.avgPerDayMonth ?? 0;
        case 'avgYear': return s.avgPerDayYear ?? 0;
        case 'avgAll': return s.avgPerDayAll ?? 0;
        case 'streak': return s.streak ?? 0;
      }
    };

    const dir = sortDir === 'asc' ? 1 : -1;

    all.sort((a, b) => {
      const av = getVal(a, sortKey);
      const bv = getVal(b, sortKey);

      if (typeof av === 'string' || typeof bv === 'string') {
        return dir * String(av).localeCompare(String(bv), 'ru', { sensitivity: 'base' });
      }
      return dir * ((Number(av) || 0) - (Number(bv) || 0));
    });

    return all;
  }, [defaultSorted, sortKey, sortDir, friendRows, meRow]);

  const sortIndicator = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '');

  const toggleSort = (key: SortKey) => {
    if (sortKey === null) {
      setSortKey(key);
      setSortDir(key === 'username' ? 'asc' : 'desc');
      return;
    }
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(key);
    setSortDir(key === 'username' ? 'asc' : 'desc');
  };

  const selectedFriendWorkouts = useMemo(() => {
    if (!selectedFriend) return [] as Workout[];
    const all = [...(friendWorkouts[selectedFriend] || [])];
    all.sort((a, b) => {
      const at = new Date(a.time || a.date).getTime();
      const bt = new Date(b.time || b.date).getTime();
      return bt - at;
    });

    return all;
  }, [selectedFriend, friendWorkouts]);

  const selectedFriendDayMap = useMemo(() => {
    const byDay = new Map<string, { items: Workout[]; totalReps: number; byExercise: Map<ExerciseType, number> }>();
    selectedFriendWorkouts.forEach((w) => {
      const dayKey = normalizeDate(new Date(w.time || w.date));
      const row = byDay.get(dayKey) ?? { items: [], totalReps: 0, byExercise: new Map<ExerciseType, number>() };
      const type = toExerciseType(w.exerciseType);
      row.items.push(w);
      row.totalReps += w.reps || 0;
      row.byExercise.set(type, (row.byExercise.get(type) ?? 0) + (w.reps || 0));
      byDay.set(dayKey, row);
    });

    for (const row of byDay.values()) {
      row.items.sort((a, b) => new Date(b.time || b.date).getTime() - new Date(a.time || a.date).getTime());
    }

    return byDay;
  }, [selectedFriendWorkouts]);

  const latestFeedWorkouts = useMemo<FeedWorkoutItem[]>(() => {
    const out: FeedWorkoutItem[] = [];
    const meLabel = me?.username || tt('Ты');

    for (const w of myWorkouts) {
      out.push({
        ...w,
        ownerUsername: meLabel,
        ownerAvatarPath: me?.avatarPath ?? null,
        isMe: true,
        occurredAt: getWorkoutTimestamp(w),
      });
    }

    for (const f of friends) {
      const list = friendWorkouts[f.username] || [];
      for (const w of list) {
        out.push({
          ...w,
          ownerUsername: f.username,
          ownerAvatarPath: f.avatarPath ?? null,
          isMe: false,
          occurredAt: getWorkoutTimestamp(w),
        });
      }
    }

    out.sort((a, b) => b.occurredAt - a.occurredAt);

    const seen = new Set<string>();
    const unique = out.filter((w) => {
      if (seen.has(w.id)) return false;
      seen.add(w.id);
      return true;
    });

    return unique.slice(0, feedLimit);
  }, [myWorkouts, me, friends, friendWorkouts, feedLimit, tt]);

  const groupedFeedWorkouts = useMemo(
    () =>
      latestFeedWorkouts.reduce<Array<{ dayKey: string; items: FeedWorkoutItem[] }>>((acc, item) => {
        const dayKey = normalizeDate(getWorkoutDate(item));
        const last = acc[acc.length - 1];
        if (last && last.dayKey === dayKey) {
          last.items.push(item);
        } else {
          acc.push({ dayKey, items: [item] });
        }
        return acc;
      }, []),
    [latestFeedWorkouts],
  );
  const friendCalendarCells = useMemo(() => {
    const year = friendCalendarMonth.getFullYear();
    const month = friendCalendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (first.getDay() + 6) % 7;
    const out: Array<{ key: string; day: number } | null> = [];

    for (let i = 0; i < mondayOffset; i += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(year, month, day);
      out.push({ key: normalizeDate(d), day });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [friendCalendarMonth]);

  const hasPendingRequests = incomingRequests.length > 0 || outgoingRequests.length > 0;
  const todayKey = normalizeDate(new Date());
  const friendWeekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map(tt);
  const selectedFriendDayData = friendDetailDay ? selectedFriendDayMap.get(friendDetailDay) ?? null : null;
  const accentColor = exerciseNumberColor('pushups');
  const accentCard = useMemo<React.CSSProperties>(
    () => ({
      ...card,
      border: `1px solid ${hexToRgba(accentColor, 0.34)}`,
      background: `linear-gradient(180deg, ${hexToRgba(accentColor, 0.14)} 0%, #f9fafb 68%)`,
    }),
    [accentColor],
  );
  const feedReactionIds = useMemo(() => latestFeedWorkouts.map((w) => w.id), [latestFeedWorkouts]);
  const modalReactionIds = useMemo(
    () => (friendDetailsOpen && selectedFriendDayData?.items?.length ? selectedFriendDayData.items.map((w) => w.id) : []),
    [friendDetailsOpen, selectedFriendDayData],
  );
  const allVisibleReactionIds = useMemo(
    () => Array.from(new Set([...feedReactionIds, ...modalReactionIds])),
    [feedReactionIds, modalReactionIds],
  );

  useEffect(() => {
    const first = selectedFriendWorkouts[0];
    if (!first) {
      setFriendCalendarMonth(monthStart(new Date()));
      return;
    }
    const firstDate = new Date(first.time || first.date);
    if (!Number.isNaN(firstDate.getTime())) {
      setFriendCalendarMonth(monthStart(firstDate));
    }
  }, [selectedFriendWorkouts]);

  useEffect(() => {
    setFriendDetailsOpen(false);
    setFriendDetailDay(null);
    setModalReactionPickerWorkoutId(null);
  }, [selectedFriend]);

  useEffect(() => {
    if (!friendDetailsOpen || !friendDetailDay) return;
    if (selectedFriendDayMap.has(friendDetailDay)) return;
    setFriendDetailsOpen(false);
    setFriendDetailDay(null);
    setModalReactionPickerWorkoutId(null);
  }, [selectedFriendDayMap, friendDetailsOpen, friendDetailDay]);

  useEffect(() => {
    if (!allVisibleReactionIds.length) {
      setFriendWorkoutReactions({});
      return;
    }
    loadFriendWorkoutReactions(allVisibleReactionIds);
  }, [allVisibleReactionIds, loadFriendWorkoutReactions]);

  useEffect(() => {
    if (!modalReactionPickerWorkoutId) return;
    const exists = Boolean(selectedFriendDayData?.items?.some((w) => w.id === modalReactionPickerWorkoutId));
    if (!exists) setModalReactionPickerWorkoutId(null);
  }, [modalReactionPickerWorkoutId, selectedFriendDayData]);

  useEffect(() => {
    if (!feedReactionPickerWorkoutId) return;
    const exists = latestFeedWorkouts.some((w) => w.id === feedReactionPickerWorkoutId);
    if (!exists) setFeedReactionPickerWorkoutId(null);
  }, [feedReactionPickerWorkoutId, latestFeedWorkouts]);

  useLayoutEffect(() => {
    const wrap = feedListRef.current;
    if (!wrap) return;
    if (feedLimit === 5) {
      const measured = Math.ceil(wrap.scrollHeight);
      if (measured > 0 && measured !== feedViewportHeight) {
        setFeedViewportHeight(measured);
      }
      return;
    }
    if (!feedViewportHeight) {
      const targetRow = wrap.querySelector<HTMLElement>('[data-feed-row-index="4"]');
      if (targetRow) {
        setFeedViewportHeight(targetRow.offsetTop + targetRow.offsetHeight + 2);
      }
    }
  }, [feedLimit, groupedFeedWorkouts, friendWorkoutReactions, feedReactionPickerWorkoutId, feedViewportHeight]);

  return (
    <div className="app-page">
      {error ? <p style={{ color: 'red', marginTop: 12 }}>{error}</p> : null}
      {info ? <p style={{ color: 'green', marginTop: 12 }}>{info}</p> : null}
      {loading ? <p style={{ marginTop: 12 }}>{tt('Загрузка…')}</p> : null}

      <section style={accentCard}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'nowrap', overflowX: 'auto' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0, whiteSpace: 'nowrap' }}>{tt('Друзья')}</h2>
          <button
            type="button"
            onClick={() => setShowAddFriendForm((prev) => !prev)}
            style={btnPlusPrimary}
            aria-label={tt('Добавить друга')}
            title={showAddFriendForm ? tt('Скрыть форму') : tt('Добавить друга')}
          >
            {showAddFriendForm ? '−' : '+'}
          </button>
        </div>

        {showAddFriendForm ? (
          <form onSubmit={handleAddFriend} style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label>{tt('Ник (username)')}</label>
              <input
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', width: 260 }}
              />
            </div>

            <button type="submit" style={btnPrimary}>{tt('Добавить')}</button>
            <button type="button" onClick={loadAll} style={btnSecondary}>{tt('Обновить')}</button>
          </form>
        ) : null}

        {sortedAll.length <= 1 ? (
          <p style={{ marginTop: 12 }}>{tt('Пока друзей нет.')}</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table style={{ width: 'max-content', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={{ ...thCompact, ...stickyNameHead }} className="table-sticky-first table-sticky-first--head">
                    <button type="button" onClick={() => toggleSort('username')} style={thBtn}>
                      {tt('Имя')} {sortIndicator('username')}
                    </button>
                  </th>

                  <th style={{ ...thCompact, ...stickyExerciseHead }}>{tt('Упр')}</th>

                  <th style={thCompact}><button type="button" onClick={() => toggleSort('today')} style={thBtn}>{tt('Сегодня')} {sortIndicator('today')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('all')} style={thBtn}>{tt('Всего')} {sortIndicator('all')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('year')} style={thBtn}>{tt('Год')} {sortIndicator('year')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('month')} style={thBtn}>{tt('Месяц')} {sortIndicator('month')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('week')} style={thBtn}>{tt('Неделя')} {sortIndicator('week')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('avgMonth')} style={thBtn}>{tt('Ср/мес')} {sortIndicator('avgMonth')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('avgYear')} style={thBtn}>{tt('Ср/год')} {sortIndicator('avgYear')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('avgAll')} style={thBtn}>{tt('Ср/всего')} {sortIndicator('avgAll')}</button></th>
                  <th style={thCompact}><button type="button" onClick={() => toggleSort('streak')} style={thBtn}>{tt('Серия')} {sortIndicator('streak')}</button></th>

                  <th style={thCompact}>{tt('Следить')}</th>
                  <th style={thCompact}>{tt('Действия')}</th>
                </tr>
              </thead>

              <tbody>
                {sortedAll.map((row) => {
                  const isMe = !!row.isMe;

                  const sBy: StatsByExercise = row.statsByExercise;
                  const uname = isMe ? tt('Ты') : row.friend.username;

                  return (
                    <tr key={isMe ? '__me__' : row.friend.friendshipId}>
                      <td style={{ ...tdCompact, ...stickyNameCell }} className="table-sticky-first">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                          <AvatarCircle src={isMe ? me?.avatarPath : row.friend.avatarPath} size={20} />
                          <div style={{ fontWeight: 900, fontSize: 12, lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {uname}
                          </div>
                        </div>
                      </td>

                      <td style={{ ...tdCompact, ...stickyExerciseCell }}>
                        <div style={exerciseIconStack}>
                          {EXERCISE_ORDER.map((type) => (
                            <Image key={`${uname}-${type}`} src={exerciseFeedIcon(type)} alt={tt(exerciseLabel(type))} width={16} height={16} style={tableExerciseIcon} unoptimized />
                          ))}
                        </div>
                      </td>

                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-today-${type}`} style={metricValue}>{sBy[type].totalToday}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-all-${type}`} style={metricValue}>{sBy[type].totalAll}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-year-${type}`} style={metricValue}>{sBy[type].totalYear}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-month-${type}`} style={metricValue}>{sBy[type].totalMonth}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-week-${type}`} style={metricValue}>{sBy[type].totalWeek}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-avgm-${type}`} style={metricValue}>{sBy[type].avgPerDayMonth || '-'}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-avgy-${type}`} style={metricValue}>{sBy[type].avgPerDayYear || '-'}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-avga-${type}`} style={metricValue}>{sBy[type].avgPerDayAll || '-'}</span>)}
                        </div>
                      </td>
                      <td style={tdNumCompact}>
                        <div style={metricStack}>
                          {EXERCISE_ORDER.map((type) => <span key={`${uname}-streak-${type}`} style={metricValue}>{sBy[type].streak}</span>)}
                        </div>
                      </td>

                      <td style={{ ...tdCompact, whiteSpace: 'nowrap' }}>
                        {isMe ? '—' : (
                          <input
                            type="checkbox"
                            checked={Boolean(row.friend.isFollowing)}
                            onChange={(e) => handleToggleFollow(row.friend as Friend, e.target.checked)}
                            aria-label={tt(`Следить за ${row.friend.username}`)}
                          />
                        )}
                      </td>

                      <td style={{ ...tdCompact, whiteSpace: 'nowrap' }}>
                        {isMe ? (
                          '—'
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRemoveFriend(row.friend.friendshipId, row.friend.username)}
                            style={btnDanger}
                          >
                            {tt('Удалить')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {hasPendingRequests ? (
        <section style={accentCard}>
          <h2 style={{ marginTop: 0 }}>{tt('Запросы в друзья')}</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {incomingRequests.length > 0 ? (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{tt('Входящие')} ({incomingRequests.length})</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {incomingRequests.map((r) => (
                    <div key={r.friendshipId} style={requestRow}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AvatarCircle src={r.avatarPath} size={26} />
                        <div>
                          <div style={{ fontWeight: 800 }}>{r.username}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(r.createdAt).toLocaleString(localeTag)}</div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button type="button" style={btnPrimary} onClick={() => handleRespondRequest(r.friendshipId, 'accept')}>{tt('Принять')}</button>
                        <button type="button" style={btnDanger} onClick={() => handleRespondRequest(r.friendshipId, 'decline')}>{tt('Отклонить')}</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {outgoingRequests.length > 0 ? (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>{tt('Исходящие')} ({outgoingRequests.length})</div>
                <div style={{ display: 'grid', gap: 8 }}>
                  {outgoingRequests.map((r) => (
                    <div key={r.friendshipId} style={requestRow}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AvatarCircle src={r.avatarPath} size={26} />
                        <div>
                          <div style={{ fontWeight: 800 }}>{r.username}</div>
                          <div style={{ fontSize: 12, color: '#6b7280' }}>{new Date(r.createdAt).toLocaleString(localeTag)}</div>
                        </div>
                      </div>
                      <button type="button" style={btnSecondary} onClick={() => handleCancelOutgoing(r.friendshipId, r.username)}>{tt('Отменить')}</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <section style={accentCard}>
        <div style={feedHeaderRow}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>{tt('Лента тренировок')}</h2>
          <div role="group" aria-label={tt('Показывать тренировок')} style={feedLimitToggleRow}>
            {FEED_LIMIT_OPTIONS.map((limit) => {
              const active = feedLimit === limit;
              return (
                <button
                  key={`feed-limit-${limit}`}
                  type="button"
                  onClick={() => setFeedLimit(limit)}
                  style={{
                    ...feedLimitToggleBtn,
                    ...(active ? feedLimitToggleBtnActive : {}),
                  }}
                  aria-pressed={active}
                >
                  {limit}
                </button>
              );
            })}
          </div>
        </div>

        {latestFeedWorkouts.length === 0 ? (
          <p style={{ margin: 0 }}>{tt('Пока нет тренировок в ленте.')}</p>
        ) : (
          <div
            ref={feedListRef}
            style={{
              ...feedListWrap,
              ...(feedLimit > 5 ? {
                ...feedListWrapScrollable,
                height: feedViewportHeight ? `${feedViewportHeight}px` : '300px',
                maxHeight: feedViewportHeight ? `${feedViewportHeight}px` : '300px',
              } : {}),
            }}
          >
            {groupedFeedWorkouts.map((group) => (
              <section key={`feed-day-${group.dayKey}`} style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 900, color: '#334155' }}>
                  {formatDateWithWeekday(group.dayKey, localeTag)}
                </div>

                {group.items.map((w) => {
                  const type = toExerciseType(w.exerciseType);
                  const typeColor = exerciseNumberColor(type);
                  const reaction = friendWorkoutReactions[w.id];
                  const pickerOpen = feedReactionPickerWorkoutId === w.id;
                  const summaryItems = REACTION_OPTIONS
                    .map((emoji) => buildReactionSummaryItem(reaction, emoji))
                    .filter((x): x is ReactionSummaryItem => Boolean(x));

                  return (
                    <article
                      key={`feed-${w.id}`}
                      data-feed-row-index={latestFeedWorkouts.findIndex((x) => x.id === w.id)}
                      onClick={() => setFeedReactionPickerWorkoutId((prev) => (prev === w.id ? null : w.id))}
                      style={{
                        ...feedRowCard,
                        border: `1px solid ${hexToRgba(typeColor, 0.42)}`,
                        background: `linear-gradient(145deg, ${hexToRgba(typeColor, 0.18)} 0%, #ffffff 75%)`,
                      }}
                    >
                      <div style={feedRowGrid}>
                        <div style={feedUserCell}>
                          <AvatarCircle src={w.ownerAvatarPath} size={26} />
                          <div style={feedUserText}>
                            <span style={{ fontWeight: 900, color: '#0f172a' }}>{w.isMe ? tt('Ты') : w.ownerUsername}</span>
                            <span style={{ color: '#475569' }}> · {formatTimeHHMM(w.time || w.date)}</span>
                          </div>
                        </div>

                        <Image src={exerciseFeedIcon(type)} alt={tt(exerciseLabel(type))} width={18} height={18} style={feedTypeIcon} unoptimized />

                        <div style={feedReps}>{formatExerciseValue(w.reps, type, true)}</div>
                      </div>

                      {summaryItems.length ? (
                        <div style={feedReactionRow}>
                          {summaryItems.map((x) => (
                            <span key={`feed-sum-${w.id}-${x.emoji}`} style={feedReactionChip}>
                              <span>{x.emoji}</span>
                              <span style={reactionCount}>{x.count}</span>
                              <span style={reactionAvatarsRow}>
                                {x.avatars.map((r) => (
                                  <span key={`feed-av-${w.id}-${x.emoji}-${r.id}`} style={reactionAvatarWrap} title={r.username}>
                                    <AvatarMini src={r.avatarPath} />
                                  </span>
                                ))}
                                {x.hasMore ? <span style={reactionMoreMark}>+</span> : null}
                              </span>
                            </span>
                          ))}
                        </div>
                      ) : null}

                      <div
                        style={{
                          ...feedPopupShell,
                        maxHeight: pickerOpen ? 52 : 0,
                        opacity: pickerOpen ? 1 : 0,
                        marginTop: pickerOpen ? 6 : 0,
                      }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div style={feedPopupPanel}>
                        {REACTION_OPTIONS.map((emoji) => {
                          const active = reaction?.myEmoji === emoji;
                          return (
                            <button
                              key={`feed-popup-${w.id}-${emoji}`}
                              type="button"
                              disabled={reactingWorkoutId === w.id}
                              onClick={() => handleFriendWorkoutReaction(w.id, emoji)}
                              style={{
                                ...reactionButton,
                                borderColor: active ? '#2563eb' : '#d1d5db',
                                background: active ? '#dbeafe' : '#fff',
                                opacity: reactingWorkoutId === w.id ? 0.6 : 1,
                                minWidth: 28,
                                width: 28,
                                height: 28,
                                padding: 0,
                                fontSize: 14,
                              }}
                            >
                              <span>{emoji}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </article>
                );
              })}
              </section>
            ))}
          </div>
        )}
      </section>

      <section style={accentCard}>
        <h2 style={{ marginTop: 0 }}>{tt('Тренировки друга')}</h2>

        {friends.length === 0 ? (
          <p>{tt('Пока друзей нет.')}</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>{tt('Выбери друга')}</label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AvatarCircle src={selectedFriendObj?.avatarPath} size={34} />
                  <select
                    value={selectedFriend}
                    onChange={(e) => setSelectedFriend(e.target.value)}
                    style={{
                      padding: 8,
                      borderRadius: 8,
                      border: `1px solid ${hexToRgba(accentColor, 0.45)}`,
                      width: 220,
                      background: '#fff',
                    }}
                  >
                    {friends
                      .map((f) => f.username)
                      .sort((a, b) => a.localeCompare(b, 'ru'))
                      .map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                  </select>
                </div>
              </div>

              <div style={{ color: '#000', fontSize: 13, marginBottom: 2 }}>
                {tt('В календаре показаны все виды тренировок.')}
              </div>
            </div>

            {selectedFriendDayMap.size === 0 ? (
              <p>{tt('Нет записей для выбранного друга по этому упражнению.')}</p>
            ) : (
              <>
                <div style={calendarNavWrap}>
                  <div style={{ fontWeight: 900, fontSize: 18, textAlign: 'center' }}>{formatMonthTitle(friendCalendarMonth, localeTag)}</div>
                  <div style={calendarNavButtons}>
                    <button type="button" style={btnSecondary} onClick={() => setFriendCalendarMonth((d) => addCalendarMonths(d, -1))}>
                      {tt('Предыдущий')}
                    </button>
                    <button type="button" style={btnSecondary} onClick={() => setFriendCalendarMonth((d) => addCalendarMonths(d, 1))}>
                      {tt('Следующий')}
                    </button>
                  </div>
                </div>

                <div style={calendarGrid}>
                  {friendWeekdays.map((day) => (
                    <div key={day} style={calendarWeekdayCell}>{day}</div>
                  ))}

                  {friendCalendarCells.map((cell, idx) => {
                    if (!cell) return <div key={`empty-${idx}`} style={calendarEmptyCell} />;
                    const row = selectedFriendDayMap.get(cell.key);
                    const hasData = Boolean(row && row.items.length);
                    const isToday = cell.key === todayKey;
                    const active = friendDetailsOpen && friendDetailDay === cell.key;
                    const cellDate = new Date(`${cell.key}T00:00:00`);
                    const dayOfWeek = cellDate.getDay();
                    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                    const baseBackground = hasData ? '#f8fafc' : '#fff';
                    const exerciseTotals = EXERCISE_ORDER
                      .map((type) => ({ type, sum: row?.byExercise.get(type) ?? 0 }))
                      .filter((x) => x.sum > 0);

                    return (
                      <button
                        key={cell.key}
                        type="button"
                        onClick={() => {
                          if (!hasData) return;
                          setFriendDetailDay(cell.key);
                          setFriendDetailsOpen(true);
                        }}
                        style={{
                          ...calendarDayCell,
                          background: isWeekend
                            ? `linear-gradient(rgba(244, 114, 182, 0.12), rgba(244, 114, 182, 0.12)), ${baseBackground}`
                            : baseBackground,
                          borderColor: isToday ? '#16a34a' : active ? '#2563eb' : hasData ? '#d1d5db' : '#f3f4f6',
                          boxShadow: isToday ? 'inset 0 0 0 1px #16a34a' : 'none',
                        }}
                      >
                        <div style={{ fontWeight: 900, textAlign: 'left', color: '#000' }}>{cell.day}</div>
                        {hasData ? (
                          <div style={friendDayValues}>
                            {exerciseTotals.map(({ type, sum }) => (
                              <span key={type} style={friendTotalValue}>
                                <Image src={exerciseFeedIcon(type)} alt={tt(exerciseLabel(type))} width={22} height={22} style={friendTotalIcon} unoptimized />
                                <span>{sum}</span>
                              </span>
                            ))}
                          </div>
                        ) : null}
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
            )}
          </>
        )}
      </section>

      {friendDetailsOpen ? (
        <div
          style={modalBackdrop}
          onClick={() => {
            setFriendDetailsOpen(false);
            setFriendDetailDay(null);
            setModalReactionPickerWorkoutId(null);
          }}
        >
          <section
            style={{
              ...modalCard,
              border: `1px solid ${hexToRgba(accentColor, 0.4)}`,
              background: `linear-gradient(180deg, ${hexToRgba(accentColor, 0.14)} 0%, #f9fafb 78%)`,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={modalTop}>
              <h2 style={{ margin: 0 }}>{tt('Подходы друга за день')}</h2>
              <button
                type="button"
                style={btnSecondary}
                onClick={() => {
                  setFriendDetailsOpen(false);
                  setFriendDetailDay(null);
                  setModalReactionPickerWorkoutId(null);
                }}
              >
                {tt('Закрыть')}
              </button>
            </div>

            {!friendDetailDay || !selectedFriendDayData ? (
              <div style={{ color: '#6b7280' }}>{tt('Нет записей на выбранный день.')}</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: '#111827', fontWeight: 800 }}>
                  {formatDateWithWeekday(friendDetailDay, localeTag)} · {tt('всего')}: {selectedFriendDayData.totalReps}
                </div>

                {selectedFriendDayData.items.map((w) => {
                  const reaction = friendWorkoutReactions[w.id];
                  const pickerOpen = modalReactionPickerWorkoutId === w.id;
                  const workoutType = toExerciseType(w.exerciseType);
                  const rowColor = exerciseNumberColor(workoutType);
                  return (
                    <div
                      key={w.id}
                      style={{
                        ...friendRowCard,
                        cursor: 'pointer',
                        borderColor: pickerOpen ? '#2563eb' : hexToRgba(rowColor, 0.45),
                        background: `linear-gradient(135deg, ${hexToRgba(rowColor, 0.14)} 0%, #ffffff 70%)`,
                      }}
                      onClick={() => setModalReactionPickerWorkoutId((prev) => (prev === w.id ? null : w.id))}
                    >
                      <div style={friendRowMain}>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <Image src={exerciseFeedIcon(workoutType)} alt={tt(exerciseLabel(workoutType))} width={16} height={16} style={friendWorkoutTypeIcon} unoptimized />
                        </div>
                        <div>{formatTimeHHMM(w.time || w.date)}</div>
                        <div style={{ fontWeight: 900 }}>{formatExerciseValue(w.reps, workoutType, true)}</div>
                      </div>

                      {reaction?.summary?.length ? (
                        <div style={reactionSummaryRow}>
                          {REACTION_OPTIONS.map((emoji) => {
                            const item = buildReactionSummaryItem(reaction, emoji);
                            if (!item) return null;
                            return (
                              <span key={`${w.id}-sum-${emoji}`} style={reactionSummaryChip}>
                                <span>{emoji}</span>
                                <span style={reactionCount}>{item.count}</span>
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

                      {pickerOpen ? (
                        <div style={reactionPickerRow} onClick={(e) => e.stopPropagation()}>
                          {REACTION_OPTIONS.map((emoji) => {
                            const active = reaction?.myEmoji === emoji;
                            return (
                              <button
                                key={`${w.id}-pick-${emoji}`}
                                type="button"
                                disabled={reactingWorkoutId === w.id}
                                onClick={() => handleFriendWorkoutReaction(w.id, emoji)}
                                style={{
                                  ...reactionButton,
                                  borderColor: active ? '#2563eb' : '#d1d5db',
                                  background: active ? '#dbeafe' : '#fff',
                                  opacity: reactingWorkoutId === w.id ? 0.6 : 1,
                                }}
                                aria-label={tt(`Реакция ${emoji}`)}
                              >
                                <span>{emoji}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : null}
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

const card: React.CSSProperties = {
  padding: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#f9fafb',
  marginBottom: 16,
};

const requestRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  flexWrap: 'wrap',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 8,
  background: '#fff',
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

const calendarEmptyCell: React.CSSProperties = {
  minHeight: 'clamp(82px, 10.5vw, 120px)',
  border: '1px dashed #f3f4f6',
  borderRadius: 10,
  background: '#fff',
};

const calendarDayCell: React.CSSProperties = {
  minHeight: 'clamp(82px, 10.5vw, 120px)',
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: '6px 6px 6px 3px',
  display: 'grid',
  gap: 4,
  alignContent: 'start',
  cursor: 'pointer',
  textAlign: 'left',
};

const friendTotalValue: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 0,
  fontSize: 'clamp(12px, 0.95vw, 17px)',
  lineHeight: 1,
  fontWeight: 900,
  color: '#000',
  whiteSpace: 'nowrap',
};

const friendDayValues: React.CSSProperties = {
  display: 'grid',
  gap: 1,
  alignContent: 'start',
  justifyItems: 'start',
  marginLeft: -1,
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

const friendTotalIcon: React.CSSProperties = {
  width: 'clamp(14px, 1.2vw, 22px)',
  height: 'clamp(14px, 1.2vw, 22px)',
  objectFit: 'contain',
  flex: '0 0 auto',
  marginLeft: -3,
  marginRight: 2,
};

const friendWorkoutTypeIcon: React.CSSProperties = {
  width: 16,
  height: 16,
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
};

const feedHeaderRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
  marginBottom: 8,
};

const feedLimitToggleRow: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const feedLimitToggleBtn: React.CSSProperties = {
  minWidth: 34,
  height: 30,
  borderRadius: 8,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#0f172a',
  fontSize: 13,
  fontWeight: 900,
  lineHeight: 1,
  cursor: 'pointer',
  padding: '0 8px',
};

const feedLimitToggleBtnActive: React.CSSProperties = {
  border: '1px solid #2563eb',
  background: '#2563eb',
  color: '#fff',
};

const feedListWrap: React.CSSProperties = {
  display: 'grid',
  gap: 9,
};

const feedListWrapScrollable: React.CSSProperties = {
  maxHeight: 'clamp(380px, 58vh, 510px)',
  overflowY: 'auto',
  overscrollBehavior: 'contain',
  paddingRight: 3,
};

const feedTypeIcon: React.CSSProperties = {
  width: 18,
  height: 18,
  objectFit: 'contain',
  display: 'block',
  flex: '0 0 auto',
};

const feedRowCard: React.CSSProperties = {
  borderRadius: 12,
  padding: '8px 10px',
  cursor: 'pointer',
};

const feedRowGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) auto auto',
  gap: 6,
  alignItems: 'center',
};

const feedUserCell: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minWidth: 0,
};

const feedUserText: React.CSSProperties = {
  minWidth: 0,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  fontSize: 12,
};

const feedReps: React.CSSProperties = {
  fontSize: 22,
  fontWeight: 900,
  color: '#0f172a',
  textAlign: 'right',
  minWidth: 44,
  whiteSpace: 'nowrap',
};

const feedReactionRow: React.CSSProperties = {
  marginTop: 6,
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
  alignItems: 'center',
};

const feedReactionChip: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#fff',
  minWidth: 32,
  minHeight: 24,
  padding: '0 6px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 13,
};

const feedPopupShell: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
  overflow: 'hidden',
  transition: 'max-height 220ms ease, opacity 220ms ease, margin-top 220ms ease',
  transformOrigin: 'top center',
};

const feedPopupPanel: React.CSSProperties = {
  borderRadius: 12,
  border: '1px solid #d1d5db',
  background: '#ffffff',
  boxShadow: '0 10px 18px rgba(15, 23, 42, 0.16)',
  padding: '8px 10px',
  display: 'inline-flex',
  gap: 8,
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
  width: 'min(560px, 100%)',
  maxHeight: '88vh',
  overflowY: 'auto',
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
};

const modalTop: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
  flexWrap: 'wrap',
};

const friendRowCard: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
  padding: '8px 10px',
  display: 'grid',
  gap: 8,
};

const friendRowMain: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr auto',
  gap: 10,
  alignItems: 'center',
};

const reactionSummaryRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const reactionSummaryChip: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#fff',
  minWidth: 36,
  minHeight: 30,
  padding: '0 8px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 16,
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

const reactionPickerRow: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  flexWrap: 'wrap',
};

const reactionButton: React.CSSProperties = {
  borderRadius: 999,
  border: '1px solid #d1d5db',
  background: '#fff',
  minWidth: 36,
  height: 30,
  padding: '0 8px',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 4,
  fontSize: 16,
  cursor: 'pointer',
};

const reactionCount: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 900,
  color: '#111827',
  lineHeight: 1,
};

const btnPrimary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer',
};

const btnPlusPrimary: React.CSSProperties = {
  width: 34,
  height: 34,
  borderRadius: 10,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#fff',
  fontWeight: 900,
  fontSize: 20,
  lineHeight: 1,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  padding: 0,
};

const btnSecondary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 800,
  color: '#000',
};

const btnDanger: React.CSSProperties = {
  padding: '8px 10px',
  borderRadius: 10,
  border: '1px solid #dc2626',
  background: '#fff',
  color: '#dc2626',
  fontWeight: 900,
  cursor: 'pointer',
};

const th: React.CSSProperties = {
  textAlign: 'left',
  padding: '10px 8px',
  borderBottom: '1px solid #e5e7eb',
  fontWeight: 900,
  color: '#000',
  whiteSpace: 'nowrap',
};

const thCompact: React.CSSProperties = {
  ...th,
  padding: '6px 4px',
  fontSize: 11,
};

const thBtn: React.CSSProperties = {
  border: 'none',
  background: 'transparent',
  padding: 0,
  margin: 0,
  font: 'inherit',
  fontWeight: 900,
  color: '#000',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '10px 8px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
  color: '#000',
};

const tdCompact: React.CSSProperties = {
  ...td,
  padding: '5px 4px',
};

const tdNumCompact: React.CSSProperties = {
  ...tdCompact,
  textAlign: 'left',
  fontVariantNumeric: 'tabular-nums',
  color: '#000',
};

const STICKY_NAME_COL_W = 'clamp(82px, 19vw, 124px)';
const STICKY_EXERCISE_COL_W = 'clamp(22px, 6vw, 30px)';

const stickyNameCell: React.CSSProperties = {
  position: 'sticky',
  left: 0,
  zIndex: 2,
  background: '#fff',
  minWidth: STICKY_NAME_COL_W,
  width: STICKY_NAME_COL_W,
  maxWidth: STICKY_NAME_COL_W,
};

const stickyNameHead: React.CSSProperties = {
  ...stickyNameCell,
  zIndex: 4,
  background: '#f3f4f6',
};

const stickyExerciseCell: React.CSSProperties = {
  position: 'sticky',
  left: STICKY_NAME_COL_W,
  zIndex: 2,
  background: '#fff',
  minWidth: STICKY_EXERCISE_COL_W,
  width: STICKY_EXERCISE_COL_W,
  maxWidth: STICKY_EXERCISE_COL_W,
  textAlign: 'center',
};

const stickyExerciseHead: React.CSSProperties = {
  ...stickyExerciseCell,
  zIndex: 4,
  background: '#f3f4f6',
};

const exerciseIconStack: React.CSSProperties = {
  display: 'grid',
  gap: 1,
  justifyItems: 'center',
  alignContent: 'start',
};

const tableExerciseIcon: React.CSSProperties = {
  width: 11,
  height: 11,
  objectFit: 'contain',
  display: 'block',
};

const metricStack: React.CSSProperties = {
  display: 'grid',
  gap: 1,
  justifyItems: 'start',
  alignContent: 'start',
};

const metricValue: React.CSSProperties = {
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 800,
  color: '#000',
  whiteSpace: 'nowrap',
};
