'use client';

import { useEffect, useMemo, useState } from 'react';

type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats';

type Workout = {
  id: string;
  reps: number;
  date: string;
  time?: string;
  exerciseType?: string;
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

const EXERCISE_ORDER: ExerciseType[] = ['pushups', 'pullups', 'crunches', 'squats'];
const REACTION_OPTIONS = ['👍', '🔥', '👎', '💩'] as const;

const EXERCISE_LABELS: Record<string, string> = {
  pushups: 'Отжимания',
  pullups: 'Подтягивания',
  crunches: 'Скручивания',
  squats: 'Приседания',
};

function toIsoTime(date: string, time: string) {
  return new Date(`${date}T${time}:00`).toISOString();
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

function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
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

function formatTimeHHMM(iso?: string) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function formatDateWithWeekday(dayKey: string) {
  const d = new Date(`${dayKey}T00:00:00`);
  return d.toLocaleDateString('ru-RU', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {}
  }
  if (!res.ok) {
    const base = data?.error || `Ошибка (код ${res.status})`;
    const details = data?.details || '';
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

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="app-tile">
      <div className="app-tile__title">{label}</div>
      <div className="app-tile__value">{value}</div>
    </div>
  );
}

function exerciseLabel(type: string | undefined) {
  return EXERCISE_LABELS[type || ''] || type || 'Упражнение';
}

function exerciseFeedIcon(type: string | undefined) {
  const v = '20260304-4';
  if (type === 'pullups') return `/icons/exercise-types/feed/pullups.svg?v=${v}`;
  if (type === 'crunches') return `/icons/exercise-types/feed/crunches.svg?v=${v}`;
  if (type === 'squats') return `/icons/exercise-types/feed/squats.svg?v=${v}`;
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
      <img src={src} alt="" width={14} height={14} style={{ width: 14, height: 14, objectFit: 'cover', display: 'block' }} />
    </span>
  );
}

export default function DashboardPage() {
  const [exerciseType, setExerciseType] = useState<ExerciseType>('pushups');
  const [workouts, setWorkouts] = useState<Workout[]>([]);

  const [date, setDate] = useState<string>(normalizeDate(new Date()));
  const [time, setTime] = useState<string>(normalizeTime(new Date()));
  const [timeTouched, setTimeTouched] = useState(false);
  const [reps, setReps] = useState<number>(0);

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

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('exerciseType');
      if (saved === 'pushups' || saved === 'pullups' || saved === 'crunches' || saved === 'squats') {
        setExerciseType(saved);
      }
    } catch {}

    const onChanged = (e: any) => {
      const next = String(e?.detail?.exerciseType || window.localStorage.getItem('exerciseType') || 'pushups');
      if (next === 'pushups' || next === 'pullups' || next === 'crunches' || next === 'squats') {
        setExerciseType(next);
      }
    };

    window.addEventListener('exerciseTypeChanged', onChanged as any);
    return () => window.removeEventListener('exerciseTypeChanged', onChanged as any);
  }, []);

  const handleExerciseTypeChange = (next: ExerciseType) => {
    setExerciseType(next);
    try {
      window.localStorage.setItem('exerciseType', next);
    } catch {}
    try {
      window.dispatchEvent(new CustomEvent('exerciseTypeChanged', { detail: { exerciseType: next } }));
    } catch {}
  };

  const loadWorkouts = async () => {
    setError(null);
    try {
      const data = await fetchJsonSafe('/api/workouts');
      setWorkouts(Array.isArray(data) ? data : (data?.items ?? []));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const loadWorkoutReactions = async (workoutIds: string[]) => {
    const ids = Array.from(new Set(workoutIds.filter(Boolean)));
    if (!ids.length) {
      setWorkoutReactions({});
      return;
    }
    try {
      const data = await fetchJsonSafe(`/api/workout-reactions?ids=${encodeURIComponent(ids.join(','))}`);
      setWorkoutReactions(data && typeof data === 'object' ? data : {});
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  useEffect(() => {
    loadWorkouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 1000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const filteredWorkouts = useMemo(
    () => workouts.filter((w) => (w.exerciseType || 'pushups') === exerciseType),
    [workouts, exerciseType],
  );

  const stats = useMemo(() => computeStats(filteredWorkouts), [filteredWorkouts]);

  const dayMap = useMemo(() => {
    const map = new Map<string, DayAggregate>();
    workouts.forEach((w) => {
      const key = normalizeDate(new Date(w.time || w.date));
      const row = map.get(key) || { items: [], byExercise: new Map<string, number>(), totalReps: 0 };
      row.items.push(w);
      const t = w.exerciseType || 'pushups';
      row.byExercise.set(t, (row.byExercise.get(t) ?? 0) + (w.reps || 0));
      row.totalReps += w.reps || 0;
      map.set(key, row);
    });

    for (const row of map.values()) {
      row.items.sort((a, b) => new Date(b.time || b.date).getTime() - new Date(a.time || a.date).getTime());
    }

    return map;
  }, [workouts]);

  useEffect(() => {
    const first = workouts[0];
    const d = toDate(first?.time || first?.date);
    if (!d) return;
    setCalendarMonth(monthStart(d));
  }, [workouts]);

  useEffect(() => {
    if (!detailsOpen || !detailDay) return;
    if (dayMap.has(detailDay)) return;
    setDetailsOpen(false);
    setDetailDay(null);
    setEditingId(null);
  }, [dayMap, detailsOpen, detailDay]);

  const calendarCells = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const first = new Date(year, month, 1);
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const mondayOffset = (first.getDay() + 6) % 7;
    const out: Array<{ key: string; day: number } | null> = [];

    for (let i = 0; i < mondayOffset; i += 1) out.push(null);
    for (let day = 1; day <= daysInMonth; day += 1) {
      const d = new Date(year, month, day);
      const key = normalizeDate(d);
      out.push({ key, day });
    }
    while (out.length % 7 !== 0) out.push(null);
    return out;
  }, [calendarMonth]);

  const handleAdd = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setInfo(null);

    const timeToSend = timeTouched ? time : normalizeTime(new Date());

    try {
      await fetchJsonSafe('/api/workouts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reps, date, time: toIsoTime(date, timeToSend), exerciseType }),
      });
      setInfo('Добавлено');
      const toast = reps >= 50 ? 'МАШИНА!!!! 💪🎉' : reps >= 21 ? '👍👍' : '👍';
      setToastMessage(toast);
      setTime(normalizeTime(new Date()));
      setTimeTouched(false);
      setReps(0);
      await loadWorkouts();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const startEdit = (w: Workout) => {
    setEditingId(w.id);
    setEditDate(normalizeDate(new Date(w.time || w.date)));
    setEditTime(normalizeTime(new Date(w.time || w.date)));
    setEditReps(w.reps || 0);
    const next = String(w.exerciseType || 'pushups');
    setEditExerciseType(
      next === 'pushups' || next === 'pullups' || next === 'crunches' || next === 'squats' ? next : 'pushups',
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
      setInfo('Изменения сохранены');
      await loadWorkouts();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const deleteWorkout = async (id: string) => {
    setError(null);
    setInfo(null);
    if (!window.confirm('Удалить эту запись?')) return;

    try {
      await fetchJsonSafe('/api/workouts', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      setInfo('Запись удалена');
      await loadWorkouts();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const selectedDayData = detailDay ? dayMap.get(detailDay) ?? null : null;
  const weekdays = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
  const todayKey = normalizeDate(new Date());

  useEffect(() => {
    if (!detailsOpen || !selectedDayData?.items?.length) {
      setWorkoutReactions({});
      return;
    }
    const ids = selectedDayData.items.map((w) => w.id);
    loadWorkoutReactions(ids);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailsOpen, selectedDayData]);

  return (
    <div className="app-page" style={{ maxWidth: 920 }}>
      {toastMessage ? <div className="app-toast">{toastMessage}</div> : null}

      <h1
        style={{
          marginBottom: 10,
          fontSize: 'clamp(20px, 5.5vw, 30px)',
          lineHeight: 1.1,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        <span>Тренировка:</span>
        <select
          value={exerciseType}
          onChange={(e) => handleExerciseTypeChange(e.target.value as ExerciseType)}
          style={{
            width: 'min(56vw, 260px)',
            minWidth: 0,
            padding: '6px 10px',
            borderRadius: 10,
            border: '1px solid #d1d5db',
            background: '#fff',
            color: '#000',
            fontWeight: 800,
            fontSize: 'clamp(14px, 3.5vw, 18px)',
            lineHeight: 1.2,
          }}
          aria-label="Тип упражнения"
        >
          <option value="pushups">Отжимания</option>
          <option value="pullups">Подтягивания</option>
          <option value="crunches">Скручивания</option>
          <option value="squats">Приседания</option>
        </select>
      </h1>

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, margin: '12px 0 18px' }}>
        <div
          style={{
            width: 'min(92vw, 520px)',
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 10,
          }}
        >
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={smallInput}
            aria-label="Дата"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setTimeTouched(true);
            }}
            style={smallInput}
            aria-label="Время"
          />
        </div>

        <input
          inputMode="numeric"
          value={String(reps)}
          onChange={(e) => {
            const v = e.target.value.replace(/[^\d]/g, '');
            setReps(v === '' ? 0 : Math.min(9999, parseInt(v, 10)));
          }}
          placeholder="0"
          style={repsInputStyle}
        />

        <div style={plusButtonsGrid}>
          <button
            type="button"
            onClick={() => setReps((prev) => Math.min(9999, (prev || 0) + 5))}
            style={plus5Button}
          >
            +5
          </button>
          <button
            type="button"
            onClick={() => setReps((prev) => Math.min(9999, (prev || 0) + 10))}
            style={plus10Button}
          >
            +10
          </button>
        </div>

        <button type="button" onClick={() => handleAdd()} style={addButton}>
          Добавить
        </button>
      </div>

      {error ? <p style={{ color: 'red', marginTop: 10 }}>{error}</p> : null}
      {info ? <p style={{ color: 'green', marginTop: 6 }}>{info}</p> : null}

      <section className="app-tiles" style={{ marginBottom: 20 }}>
        <Stat label="Сегодня" value={stats.totalToday} />
        <Stat label="Всего" value={stats.totalAll} />
        <Stat label="Текущий год" value={stats.totalYear} />
        <Stat label="Текущий месяц" value={stats.totalMonth} />
        <Stat label="Текущая неделя" value={stats.totalWeek} />
        <Stat label="Среднее/день (месяц)" value={stats.avgPerDayMonth || '-'} />
        <Stat label="Среднее/день (год)" value={stats.avgPerDayYear || '-'} />
        <Stat label="Среднее/день (всего)" value={stats.avgPerDayAll || '-'} />
        <Stat label="Серия дней подряд" value={stats.streak} />
      </section>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Календарь записей</h2>
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
          {weekdays.map((day) => (
            <div key={day} style={calendarWeekdayCell}>{day}</div>
          ))}

          {calendarCells.map((cell, idx) => {
            if (!cell) return <div key={`empty-${idx}`} style={calendarEmptyCell} />;
            const row = dayMap.get(cell.key);
            const hasData = Boolean(row && row.items.length);
            const active = detailsOpen && detailDay === cell.key;
            const isToday = cell.key === todayKey;
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
                  setDetailDay(cell.key);
                  setDetailsOpen(true);
                  setEditingId(null);
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
                <div style={exerciseNumbersRow}>
                  {exerciseTotals.map(({ type, sum }) => (
                    <span key={type} style={exerciseNumberItem}>
                      <img src={exerciseFeedIcon(type)} alt={exerciseLabel(type)} style={exerciseNumberIcon} />
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
              <img src={exerciseFeedIcon(type)} alt={exerciseLabel(type)} style={legendIcon} />
              <span>{exerciseLabel(type)}</span>
            </div>
          ))}
        </div>
      </section>

      {detailsOpen ? (
        <div
          style={modalBackdrop}
          onClick={() => {
            setDetailsOpen(false);
            setEditingId(null);
          }}
        >
          <section style={modalCard} onClick={(e) => e.stopPropagation()}>
            <div style={modalTop}>
              <h2 style={{ margin: 0 }}>Подходы за день</h2>
              <button
                type="button"
                style={btnSecondary}
                onClick={() => {
                  setDetailsOpen(false);
                  setEditingId(null);
                }}
              >
                Закрыть
              </button>
            </div>

            {!detailDay || !selectedDayData ? (
              <div style={{ color: '#6b7280' }}>Нет записей на выбранный день.</div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: '#111827', fontWeight: 800 }}>
                  {formatDateWithWeekday(detailDay)} · всего: {selectedDayData.totalReps}
                </div>

                {selectedDayData.items.map((w) => {
                  const reaction = workoutReactions[w.id];
                  return (
                    <div key={w.id} style={rowCard}>
                      {editingId === w.id ? (
                        <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                          <div style={editGrid}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>Упражнение</label>
                              <select
                                value={editExerciseType}
                                onChange={(e) => setEditExerciseType(e.target.value as ExerciseType)}
                                style={editInput}
                              >
                                <option value="pushups">Отжимания</option>
                                <option value="pullups">Подтягивания</option>
                                <option value="crunches">Скручивания</option>
                                <option value="squats">Приседания</option>
                              </select>
                            </div>

                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>Дата</label>
                              <input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} style={editInput} />
                            </div>

                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>Время</label>
                              <input type="time" value={editTime} onChange={(e) => setEditTime(e.target.value)} style={editInput} />
                            </div>

                            <div style={{ display: 'grid', gap: 4 }}>
                              <label>Повторы</label>
                              <input
                                type="number"
                                value={editReps}
                                onChange={(e) => setEditReps(Number(e.target.value))}
                                style={editInput}
                              />
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <button type="button" onClick={saveEdit} style={btnPrimary}>Сохранить</button>
                            <button type="button" onClick={cancelEdit} style={btnSecondary}>Отмена</button>
                          </div>
                        </div>
                      ) : (
                        <div style={{ display: 'grid', gap: 8, width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%' }}>
                            <div style={{ display: 'grid', gap: 4 }}>
                              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                                <img src={exerciseFeedIcon(w.exerciseType)} alt={exerciseLabel(w.exerciseType)} style={detailsExerciseIcon} />
                                <span style={{ fontWeight: 800 }}>{exerciseLabel(w.exerciseType)}</span>
                              </div>
                              <div>Время: <b>{formatTimeHHMM(w.time || w.date)}</b></div>
                              <div>Повторы: <b>{w.reps}</b></div>
                            </div>

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => startEdit(w)} style={btnSecondary}>Редактировать</button>
                              <button type="button" onClick={() => deleteWorkout(w.id)} style={btnDanger}>Удалить</button>
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

const smallInput: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: 12,
  border: '1px solid #d1d5db',
  background: '#fff',
  textAlign: 'center',
  fontWeight: 700,
};

const repsInputStyle: React.CSSProperties = {
  width: 'min(92vw, 520px)',
  textAlign: 'center',
  fontWeight: 800,
  fontSize: 'clamp(84px, 20vw, 180px)',
  lineHeight: 1.05,
  padding: '12px 14px',
  borderRadius: 16,
  border: '2px solid #e5e7eb',
  outline: 'none',
  color: '#000',
  background: '#fff',
};

const plusButtonsGrid: React.CSSProperties = {
  width: 'min(75vw, 520px)',
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 12,
};

const plusButtonBase: React.CSSProperties = {
  height: 'clamp(72px, 18vw, 130px)',
  width: '100%',
  borderRadius: 14,
  border: 'none',
  color: '#000',
  fontWeight: 800,
  fontSize: 'clamp(36px, 10vw, 72px)',
  lineHeight: 1,
  cursor: 'pointer',
};

const plus5Button: React.CSSProperties = {
  ...plusButtonBase,
  background: '#facc15',
};

const plus10Button: React.CSSProperties = {
  ...plusButtonBase,
  background: '#22c55e',
};

const addButton: React.CSSProperties = {
  width: 'min(75vw, 520px)',
  padding: '14px 16px',
  borderRadius: 14,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 800,
  fontSize: 20,
  cursor: 'pointer',
};

const card: React.CSSProperties = {
  marginTop: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
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
  minHeight: 88,
  border: '1px dashed #f3f4f6',
  borderRadius: 10,
  background: '#fff',
};

const calendarDayCell: React.CSSProperties = {
  minHeight: 88,
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  padding: 6,
  display: 'grid',
  gap: 4,
  alignContent: 'start',
  cursor: 'pointer',
  textAlign: 'left',
};

const exerciseNumbersRow: React.CSSProperties = {
  display: 'grid',
  gap: 0,
  alignContent: 'start',
};

const exerciseNumber: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  lineHeight: 1,
  fontWeight: 900,
  color: '#000',
  whiteSpace: 'nowrap',
};

const exerciseNumberItem: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 2,
  whiteSpace: 'nowrap',
  minWidth: 0,
};

const exerciseNumberIcon: React.CSSProperties = {
  width: 12,
  height: 12,
  objectFit: 'contain',
  flex: '0 0 auto',
  marginLeft: -2,
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
  gap: 6,
  fontSize: 12,
  fontWeight: 800,
  color: '#000',
};

const legendIcon: React.CSSProperties = {
  width: 16,
  height: 16,
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
  border: '1px solid #d1d5db',
  background: '#fff',
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
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
  padding: 10,
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

const editGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 8,
};

const editInput: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
};

const btnPrimary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 800,
};

const btnDanger: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#dc2626',
  color: '#fff',
  fontWeight: 800,
  cursor: 'pointer',
};
