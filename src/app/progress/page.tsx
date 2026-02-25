'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type Workout = {
  id: string;
  reps: number;
  date: string; // ISO
  time?: string; // ISO (если есть)
  exerciseType?: string;
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

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function normalizeDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
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

    const [yy, mm, dd] = dayKey.split('-').map(Number);
    const dayDate = new Date(yy, (mm || 1) - 1, dd || 1);

    if (dayDate >= weekStart && dayDate <= today) totalWeek += repsSum;
    if (dayDate >= monthStart && dayDate <= today) totalMonth += repsSum;
    if (dayDate >= yearStart && dayDate <= today) totalYear += repsSum;
  }

  const todayKey = normalizeDate(today);
  const totalToday = byDay.get(todayKey) ?? 0;

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

  return { totalAll, totalToday, totalWeek, totalMonth, totalYear, avgPerDayMonth, avgPerDayYear, avgPerDayAll, streak };
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="app-tile">
      <div className="app-tile__title">{label}</div>
      <div className="app-tile__value">{value}</div>
    </div>
  );
}

function StatsTilesMain({ stats }: { stats: Stats }) {
  return (
    <section className="app-tiles" style={{ marginBottom: 10 }}>
      <Stat label="Сегодня" value={stats.totalToday} />
      <Stat label="Текущий год" value={stats.totalYear} />
      <Stat label="Всего" value={stats.totalAll} />
    </section>
  );
}

function StatsTilesMore({ stats }: { stats: Stats }) {
  return (
    <section className="app-tiles" style={{ marginBottom: 10 }}>
      <Stat label="Текущий месяц" value={stats.totalMonth} />
      <Stat label="Текущая неделя" value={stats.totalWeek} />
      <Stat label="Среднее/день (месяц)" value={stats.avgPerDayMonth || '-'} />
      <Stat label="Среднее/день (год)" value={stats.avgPerDayYear || '-'} />
      <Stat label="Среднее/день (всего)" value={stats.avgPerDayAll || '-'} />
      <Stat label="Серия дней подряд" value={stats.streak} />
    </section>
  );
}

export default function ProgressPage() {
  const [pushups, setPushups] = useState<Workout[]>([]);
  const [pullups, setPullups] = useState<Workout[]>([]);
  const [crunches, setCrunches] = useState<Workout[]>([]);
  const [squats, setSquats] = useState<Workout[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState<Record<string, boolean>>({
    pushups: false,
    pullups: false,
    crunches: false,
    squats: false,
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        const [pu, pl, cr, sq] = await Promise.all([
          fetchJsonSafe('/api/workouts?exerciseType=pushups'),
          fetchJsonSafe('/api/workouts?exerciseType=pullups'),
          fetchJsonSafe('/api/workouts?exerciseType=crunches'),
          fetchJsonSafe('/api/workouts?exerciseType=squats'),
        ]);

        const puItems = Array.isArray(pu) ? pu : (pu?.items ?? []);
        const plItems = Array.isArray(pl) ? pl : (pl?.items ?? []);
        const crItems = Array.isArray(cr) ? cr : (cr?.items ?? []);
        const sqItems = Array.isArray(sq) ? sq : (sq?.items ?? []);
if (cancelled) return;

        setPushups(puItems);
        setPullups(plItems);
        setCrunches(crItems);
        setSquats(sqItems);
      } catch (e: any) {
        if (cancelled) return;
        setError(e?.message || 'Ошибка загрузки');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const pushupStats = useMemo(() => computeStats(pushups), [pushups]);
  const pullupStats = useMemo(() => computeStats(pullups), [pullups]);
  const crunchStats = useMemo(() => computeStats(crunches), [crunches]);
  const squatStats = useMemo(() => computeStats(squats), [squats]);

  return (
    <div className="app-page" style={{ maxWidth: 980 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Сводка</h1>
        <Link href="/dashboard" style={{ textDecoration: 'none' }}>← На тренировку</Link>
      </div>

      {error && <p style={{ color: 'red', marginTop: 10 }}>{error}</p>}

	      <h2 style={{ marginTop: 10, marginBottom: 8 }}>Отжимания</h2>
	      <StatsTilesMain stats={pushupStats} />
	      <button
	        type="button"
	        onClick={() => setDetailsOpen((s) => ({ ...s, pushups: !s.pushups }))}
	        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', marginBottom: 18 }}
	      >
	        {detailsOpen.pushups ? 'Скрыть' : 'Подробнее'}
	      </button>
	      {detailsOpen.pushups && <StatsTilesMore stats={pushupStats} />}

	      <h2 style={{ marginTop: 10, marginBottom: 8 }}>Подтягивания</h2>
	      <StatsTilesMain stats={pullupStats} />
	      <button
	        type="button"
	        onClick={() => setDetailsOpen((s) => ({ ...s, pullups: !s.pullups }))}
	        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', marginBottom: 18 }}
	      >
	        {detailsOpen.pullups ? 'Скрыть' : 'Подробнее'}
	      </button>
	      {detailsOpen.pullups && <StatsTilesMore stats={pullupStats} />}

	      <h2 style={{ marginTop: 10, marginBottom: 8 }}>Скручивания</h2>
	      <StatsTilesMain stats={crunchStats} />
	      <button
	        type="button"
	        onClick={() => setDetailsOpen((s) => ({ ...s, crunches: !s.crunches }))}
	        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', marginBottom: 18 }}
	      >
	        {detailsOpen.crunches ? 'Скрыть' : 'Подробнее'}
	      </button>
	      {detailsOpen.crunches && <StatsTilesMore stats={crunchStats} />}

	      <h2 style={{ marginTop: 10, marginBottom: 8 }}>Приседания</h2>
	      <StatsTilesMain stats={squatStats} />
	      <button
	        type="button"
	        onClick={() => setDetailsOpen((s) => ({ ...s, squats: !s.squats }))}
	        style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', marginBottom: 18 }}
	      >
	        {detailsOpen.squats ? 'Скрыть' : 'Подробнее'}
	      </button>
	      {detailsOpen.squats && <StatsTilesMore stats={squatStats} />}
    </div>
  );
}
