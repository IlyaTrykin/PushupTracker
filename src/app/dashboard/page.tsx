'use client';

function toIsoTime(date: string, time: string) {
  // date: YYYY-MM-DD, time: HH:MM (локальное время пользователя)
  // -> ISO UTC строка, чтобы не было сдвига при отображении
  return new Date(`${date}T${time}:00`).toISOString();
}


import { useEffect, useMemo, useRef, useState } from 'react';

type Workout = {
  id: string;
  reps: number;
  date: string; // ISO (date-only stored as DateTime)
  time?: string; // ISO (date+time)
  exerciseType?: string;
};

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

function formatTimeHHMM(iso?: string) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function Stat({ label, value }: { label: string; value: any }) {

  return (
    <div className="app-tile">
      <div className="app-tile__title">{label}</div>
      <div className="app-tile__value">{value}</div>
    </div>
  );
}

export default function DashboardPage() {
  const [exerciseType, setExerciseType] = useState<'pushups' | 'pullups' | 'crunches' | 'squats'>('pushups');

  const EXERCISE_LABELS: Record<string, string> = {
    pushups: 'Отжимания',
    pullups: 'Подтягивания',
    crunches: 'Скручивания',
    squats: 'Приседания',
  };
  const exerciseLabel = EXERCISE_LABELS[exerciseType] ?? 'Отжимания';
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('exerciseType');
      if (saved === 'pushups' || saved === 'pullups' || saved === 'crunches' || saved === 'squats') setExerciseType(saved as any);
    } catch {}

      const onChanged = (e: any) => {
    const next = String(e?.detail?.exerciseType || window.localStorage.getItem('exerciseType') || 'pushups');
    setExerciseType(next as any);
  };
    window.addEventListener('exerciseTypeChanged', onChanged as any);
    return () => window.removeEventListener('exerciseTypeChanged', onChanged as any);
  }, []);

  const [workouts, setWorkouts] = useState<Workout[]>([]);
  const visibleWorkouts = (workouts ?? []).filter((w: any) => w.exerciseType === exerciseType);
  const [date, setDate] = useState<string>(normalizeDate(new Date()));
  const [time, setTime] = useState<string>(normalizeTime(new Date()));
  const [timeTouched, setTimeTouched] = useState(false);
  const [reps, setReps] = useState<number>(0);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!toastMessage) return;
    const t = window.setTimeout(() => setToastMessage(null), 1000);
    return () => window.clearTimeout(t);
  }, [toastMessage]);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDate, setEditDate] = useState<string>(normalizeDate(new Date()));
  const [editTime, setEditTime] = useState<string>(normalizeTime(new Date()));
  const [editReps, setEditReps] = useState<number>(0);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const loadWorkouts = async () => {
    setError(null);
    try {
      const data = await fetchJsonSafe(`/api/workouts?exerciseType=${exerciseType}`);
      setWorkouts(Array.isArray(data) ? data : (data?.items ?? []));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  useEffect(() => {
    loadWorkouts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseType]);

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
      const submitted = reps;
      const toast = submitted >= 50 ? 'МАШИНА!!!! 💪🎉' : (submitted >= 21 ? '👍👍' : '👍');
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
    const tIso = w.time || w.date;
    setEditTime(normalizeTime(new Date(tIso)));
    setEditReps(w.reps || 0);
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
        body: JSON.stringify({exerciseType, id: editingId, reps: editReps, date: editDate, time: toIsoTime(editDate, editTime) }),
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

    const ok = window.confirm('Удалить эту запись?');
    if (!ok) return;

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

  // ---- статистика (календарная неделя/месяц/год) ----
  const stats = useMemo(() => {
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

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const yearStart = new Date(today.getFullYear(), 0, 1);

    const daysMonth = Math.floor((today.getTime() - monthStart.getTime()) / msInDay) + 1;
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
      if (dayDate >= monthStart && dayDate <= today) totalMonth += repsSum;
      if (dayDate >= yearStart && dayDate <= today) totalYear += repsSum;
    }

    const avgPerDayMonth = daysMonth > 0 ? Math.round(totalMonth / daysMonth) : 0;
    const avgPerDayYear = daysYear > 0 ? Math.round(totalYear / daysYear) : 0;

    // average per day for all time (from first workout date to today)
    let avgPerDayAll = 0;
    if (byDay.size > 0) {
      const firstKey = Array.from(byDay.keys()).sort()[0];
      const [fy, fm, fd] = firstKey.split('-').map(Number);
      const firstDate = new Date(fy, (fm || 1) - 1, fd || 1);
      const daysAll = Math.floor((today.getTime() - firstDate.getTime()) / msInDay) + 1;
      avgPerDayAll = daysAll > 0 ? Math.round(totalAll / daysAll) : 0;
    }

    // streak
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
        } else break;
      }
    }

    const todayKey = normalizeDate(today);
    const totalToday = byDay.get(todayKey) ?? 0;

    return { totalAll, totalToday, totalWeek, totalMonth, totalYear, avgPerDayMonth, avgPerDayYear, avgPerDayAll, streak };
  }, [workouts]);
  const title = exerciseLabel;
  const sortedWorkouts = useMemo(() => {
    return workouts
      .slice()
      .sort((a, b) => {
        const aT = new Date(a.time || a.date).getTime();
        const bT = new Date(b.time || b.date).getTime();
        return bT - aT;
      });
  }, [workouts]);

  return (
    <div className="app-page" style={{ maxWidth: 750 }}>
      {toastMessage && <div className="app-toast">{toastMessage}</div>}
      <h1 style={{ marginBottom: 10 }}>Дашборд: {title}</h1>
      {/* QUICK_INPUT_BLOCK */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        margin: '12px 0 18px',
      }}>
        {/* Date & time picker (centered above input) */}
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
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid #d1d5db',
              background: '#fff',
              textAlign: 'center',
              fontWeight: 700,
            }}
            aria-label="Дата"
          />
          <input
            type="time"
            value={time}
            onChange={(e) => {
              setTime(e.target.value);
              setTimeTouched(true);
            }}
            style={{
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid #d1d5db',
              background: '#fff',
              textAlign: 'center',
              fontWeight: 700,
            }}
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
          style={{
            width: 'min(92vw, 520px)',
            textAlign: 'center',
            fontWeight: 800,
            fontSize: 'clamp(84px, 20vw, 180px)', // 2 цифры ≈ половина экрана
            lineHeight: 1.05,
            padding: '12px 14px',
            borderRadius: 16,
            border: '2px solid #e5e7eb',
            outline: 'none',
            color: '#000',
            background: '#fff',
          }}
        />

        <div style={{
          width: 'min(75vw, 520px)', // ~3/4 экрана
          ['--btn' as any]: 'clamp(72px, 18vw, 130px)',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}>
          <button
            type="button"
            onClick={() => setReps((prev) => Math.min(9999, (prev || 0) + 5))}
            style={{
              height: 'var(--btn)' as any,
              width: '100%',
              borderRadius: 14,
              border: 'none',
              background: '#facc15', // жёлтая
              color: '#000',
              fontWeight: 800,
              fontSize: 'calc(var(--btn) * 0.8)' as any,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            +5
          </button>

          <button
            type="button"
            onClick={() => setReps((prev) => Math.min(9999, (prev || 0) + 10))}
            style={{
              height: 'var(--btn)' as any,
              width: '100%',
              borderRadius: 14,
              border: 'none',
              background: '#22c55e', // зелёная
              color: '#000',
              fontWeight: 800,
              fontSize: 'calc(var(--btn) * 0.8)' as any,
              lineHeight: 1,
              cursor: 'pointer',
            }}
          >
            +10
          </button>
        </div>

        <button
          type="button"
          onClick={async () => {
            await handleAdd();
          }}
          style={{
            width: 'min(75vw, 520px)', // ровно под +5/+10
            padding: '14px 16px',
            borderRadius: 14,
            border: 'none',
            background: '#2563eb', // синяя
            color: '#fff',
            fontWeight: 800,
            fontSize: 20,
            cursor: 'pointer',
          }}
        >
          Добавить
        </button>
      </div>

      {error && <p style={{ color: 'red', marginTop: 10 }}>{error}</p>}
      {info && <p style={{ color: 'green', marginTop: 6 }}>{info}</p>}


      <section className="app-tiles" style={{ marginBottom: 20 }}>
        <Stat label="Сегодня" value={stats.totalToday} />
        <Stat label="Всего" value={stats.totalAll} />
        <Stat label="Текущий год" value={stats.totalYear} />
        <Stat label="Текущий месяц" value={stats.totalMonth} />
        <Stat label="Текущая неделя" value={stats.totalWeek} />
        <Stat label="Среднее/день (месяц)" value={stats.avgPerDayMonth || '-'} />
        <Stat label="Среднее/день (год)" value={stats.avgPerDayYear || '-'} />
        <Stat label="Среднее/день (Всего)" value={stats.avgPerDayAll || '-'} />
        <Stat label="Серия дней подряд" value={stats.streak} />
      </section>
      <h2 style={{ marginTop: 22 }}>Записи</h2>

      <div style={{ display: 'grid', gap: 10 }}>
        {sortedWorkouts.length === 0 ? (
          <div style={{ color: '#000' }}>Пока нет записей.</div>
        ) : (
          sortedWorkouts.map((w) => (
            <div key={w.id} style={{ padding: 12, borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff' }}>
              {editingId === w.id ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label>Дата</label>
                    <input
                      type="date"
                      value={editDate}
                      onChange={(e) => setEditDate(e.target.value)}
                      style={{ padding: 8, borderRadius: 6, border: '1px solid #ccc' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label>Время</label>
                    <input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      style={{ padding: 8, borderRadius: 6, border: '1px solid #ccc' }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <label>Повторы</label>
                    <input
                      type="number"
                      value={editReps}
                      onChange={(e) => setEditReps(Number(e.target.value))}
                      style={{ padding: 8, borderRadius: 6, border: '1px solid #ccc', width: 140 }}
                    />
                  </div>

                  <button type="button" onClick={saveEdit} style={btnPrimary}>Сохранить</button>
                  <button type="button" onClick={cancelEdit} style={btnSecondary}>Отмена</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 900 }}>
                      {new Date(w.date).toLocaleDateString()} {w.time ? `· ${formatTimeHHMM(w.time)}` : ''}
                    </div>
                    <div style={{ color: '#000' }}>
                      Повторы: <b>{w.reps}</b>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button type="button" onClick={() => startEdit(w)} style={btnSecondary}>Редактировать</button>
                    <button type="button" onClick={() => deleteWorkout(w.id)} style={btnDanger}>Удалить</button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

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
