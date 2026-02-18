'use client';

import React, { useEffect, useMemo, useState } from 'react';

interface Friend {
  friendshipId: string;
  userId: string;
  username: string;
  email: string | null;
  avatarPath?: string | null;
  since: string;
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
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size, objectFit: 'cover', display: 'block' }}
      />
    </span>
  );
}


interface Workout {
  id: string;
  reps: number;
  date: string;          // ISO date
  time?: string | null;  // ISO datetime (если есть)
  exerciseType?: 'pushups' | 'pullups' | 'crunches' | 'squats';
}

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
  | 'streak'
  | 'dToday'
  | 'dAll'
  | 'dYear'
  | 'dMonth'
  | 'dWeek';

function normalizeDate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const day = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function calcStats(workouts: Workout[]): Stats {
  const byDay = new Map<string, number>();

  for (const w of workouts) {
    const dt = new Date((w.time || w.date) as any);
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

function deltaMyMinusFriend(my: number, fr: number) {
  return my - fr; // + => я впереди, - => друг впереди
}

function deltaStyle(n: number): React.CSSProperties {
  if (n > 0) return { color: '#16a34a', fontWeight: 900 };
  if (n < 0) return { color: '#dc2626', fontWeight: 900 };
  return { color: '#000', fontWeight: 900 };
}

function formatTimeHHMM(iso?: string | null) {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function fetchJson(url: string) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
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

export default function FriendsPage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [me, setMe] = useState<{ id: string; username: string; avatarPath: string | null } | null>(null);
  const [newUsername, setNewUsername] = useState('');
  const [exerciseType, setExerciseType] = useState<'pushups' | 'pullups' | 'crunches' | 'squats'>('pushups');

  const EXERCISE_LABELS: Record<string, string> = {
    pushups: 'Отжимания',
    pullups: 'Подтягивания',
    crunches: 'Скручивания',
    squats: 'Приседания',
  };
  const exerciseLabel = EXERCISE_LABELS[exerciseType] ?? 'Отжимания';
  // сортировка: null => режим по умолчанию (Ты сверху + друзья по алфавиту)
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const [selectedFriend, setSelectedFriend] = useState<string>(''); // username
  const selectedFriendObj = useMemo(() => friends.find((f) => f.username === selectedFriend) || null, [friends, selectedFriend]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [myWorkouts, setMyWorkouts] = useState<Workout[]>([]);
  const [friendWorkouts, setFriendWorkouts] = useState<Record<string, Workout[]>>({});

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('exerciseType');
      if (saved === 'pushups' || saved === 'pullups' || saved === 'crunches' || saved === 'squats') setExerciseType(saved as any);
    } catch {}

    const onChanged = (e: any) => {
      // Поддерживаем оба формата события:
      // 1) detail: 'pushups'
      // 2) detail: { exerciseType: 'pushups' }
      const t = (e?.detail?.exerciseType ?? e?.detail) as any;
      if (t === 'pushups' || t === 'pullups' || t === 'crunches' || t === 'squats') setExerciseType(t);
    };
    window.addEventListener('exerciseTypeChanged', onChanged as any);
    return () => window.removeEventListener('exerciseTypeChanged', onChanged as any);
  }, []);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);

    try {
      const meData = (await fetchJson('/api/me')) as { id: string; username: string; avatarPath: string | null };
      setMe(meData || null);

      const mine = (await fetchJson(`/api/workouts?exerciseType=${exerciseType}`)) as Workout[];
      setMyWorkouts(mine || []);

      const fr = (await fetchJson('/api/friends')) as Friend[];
      setFriends(fr || []);

      const byUser = (await fetchJson(`/api/friends/workouts?exerciseType=${exerciseType}`)) as Record<string, Workout[]>;
      setFriendWorkouts((byUser && typeof byUser === 'object') ? byUser : {});
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseType]);

  // Авто-выбор друга в выпадающем меню
  useEffect(() => {
    if (!friends || friends.length === 0) {
      setSelectedFriend('');
      return;
    }
    const exists = friends.some((f) => f.username === selectedFriend);
    if (!selectedFriend || !exists) setSelectedFriend(friends[0].username);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friends]);

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const username = newUsername.trim();
    if (!username) {
      setError('Введите ник друга');
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
      let data: any = null;
      if (text) {
        try { data = JSON.parse(text); } catch {}
      }

      if (!res.ok) {
        const base = data?.error || `Ошибка добавления друга (код ${res.status})`;
        const details = data?.details || '';
        throw new Error(details ? `${base}: ${details}` : base);
      }

      setNewUsername('');
      setInfo(`Пользователь ${data.username} добавлен в друзья`);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const handleRemoveFriend = async (friendshipId: string, username: string) => {
    const ok = window.confirm(`Удалить пользователя ${username} из друзей?`);
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
      let data: any = null;
      if (text) {
        try { data = JSON.parse(text); } catch {}
      }

      if (!res.ok) {
        const base = data?.error || `Ошибка удаления друга (код ${res.status})`;
        const details = data?.details || '';
        throw new Error(details ? `${base}: ${details}` : base);
      }

      setInfo(`Пользователь ${username} удалён из друзей`);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const myStats = useMemo(() => calcStats(myWorkouts), [myWorkouts]);

  const friendRows = useMemo(() => {
    return friends.map((f) => {
      const w = friendWorkouts[f.username] || [];
      const stats = calcStats(w);
      return { friend: f, stats };
    });
  }, [friends, friendWorkouts]);

  const meRow = useMemo(() => {
    return {
      key: '__me__',
      username: 'Ты',
      friendshipId: '__me__',
      stats: myStats,
      isMe: true,
    };
  }, [myStats]);

  // Режим по умолчанию: Ты сверху + друзья по алфавиту
  const defaultSorted = useMemo(() => {
    const sortedFriends = [...friendRows].sort((a, b) =>
      (a.friend.username || '').localeCompare(b.friend.username || '', 'ru', { sensitivity: 'base' })
    );

    return [
      meRow,
      ...sortedFriends.map((x) => ({ ...x, isMe: false })),
    ];
  }, [friendRows, meRow]);

  // Сортировка по колонке: сортируются ВСЕ строки, включая "Ты"
  const sortedAll = useMemo(() => {
    if (!sortKey) return defaultSorted;

    const all = [
      { ...meRow, friend: { username: 'Ты', friendshipId: '__me__' } as any, isMe: true },
      ...friendRows.map((x) => ({ ...x, isMe: false })),
    ];

    const getVal = (row: any, key: SortKey): string | number => {
      const s: Stats = row.isMe ? myStats : row.stats;
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

        case 'dToday': return deltaMyMinusFriend(myStats.totalToday, s.totalToday);
        case 'dAll': return deltaMyMinusFriend(myStats.totalAll, s.totalAll);
        case 'dYear': return deltaMyMinusFriend(myStats.totalYear, s.totalYear);
        case 'dMonth': return deltaMyMinusFriend(myStats.totalMonth, s.totalMonth);
        case 'dWeek': return deltaMyMinusFriend(myStats.totalWeek, s.totalWeek);
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
  }, [defaultSorted, sortKey, sortDir, friendRows, myStats, meRow]);

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

  const resetSort = () => {
    setSortKey(null);
    setSortDir('asc');
  };

  const selectedFriendWorkouts = useMemo(() => {
    if (!selectedFriend) return [] as Workout[];
    const raw = friendWorkouts[selectedFriend] || [];
    const filtered = raw.filter((w) => (w.exerciseType ? w.exerciseType === exerciseType : true));

    filtered.sort((a, b) => {
      const at = new Date(a.time || a.date).getTime();
      const bt = new Date(b.time || b.date).getTime();
      return bt - at;
    });

    return filtered;
  }, [selectedFriend, friendWorkouts, exerciseType]);

  return (
    <div className="app-page">
      <h1 style={{ marginBottom: 10 }}>Друзья и сравнение</h1>

      <p style={{ marginBottom: 16, color: '#000' }}>
        Периоды: текущая календарная неделя (с понедельника), месяц (с 1-го), год (с 1 января).
      </p>

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Добавить друга</h2>

        <form onSubmit={handleAddFriend} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label>Ник (username)</label>
            <input
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', width: 260 }}
            />
          </div>

          <button type="submit" style={btnPrimary}>Добавить</button>
          <button type="button" onClick={loadAll} style={btnSecondary}>Обновить</button>
        </form>

        {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
        {info && <p style={{ color: 'green', marginTop: 12 }}>{info}</p>}
        {loading && <p style={{ marginTop: 12 }}>Загрузка…</p>}
      </section>

      <section style={card}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <h2 style={{ marginTop: 0, marginBottom: 0 }}>Сравнение с друзьями</h2>
          <button type="button" onClick={resetSort} style={btnSecondary}>
            Сбросить сортировку
          </button>
        </div>

        {sortedAll.length <= 1 ? (
          <p style={{ marginTop: 12 }}>Пока друзей нет.</p>
        ) : (
          <div className="table-scroll" style={{ marginTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={th} className="table-sticky-first table-sticky-first--head">
                    <button type="button" onClick={() => toggleSort('username')} style={thBtn}>
                      Имя {sortIndicator('username')}
                    </button>
                  </th>

                  <th style={th}><button type="button" onClick={() => toggleSort('today')} style={thBtn}>Сегодня {sortIndicator('today')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('dToday')} style={thBtn}>Δ {sortIndicator('dToday')}</button></th>

                  <th style={th}><button type="button" onClick={() => toggleSort('all')} style={thBtn}>Всего {sortIndicator('all')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('dAll')} style={thBtn}>Δ {sortIndicator('dAll')}</button></th>

                  <th style={th}><button type="button" onClick={() => toggleSort('year')} style={thBtn}>Год {sortIndicator('year')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('dYear')} style={thBtn}>Δ {sortIndicator('dYear')}</button></th>

                  <th style={th}><button type="button" onClick={() => toggleSort('month')} style={thBtn}>Тек. месяц {sortIndicator('month')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('dMonth')} style={thBtn}>Δ {sortIndicator('dMonth')}</button></th>

                  <th style={th}><button type="button" onClick={() => toggleSort('week')} style={thBtn}>Тек. неделя {sortIndicator('week')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('dWeek')} style={thBtn}>Δ {sortIndicator('dWeek')}</button></th>

                  <th style={th}><button type="button" onClick={() => toggleSort('avgMonth')} style={thBtn}>Ср/день мес {sortIndicator('avgMonth')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('avgYear')} style={thBtn}>Ср/день год {sortIndicator('avgYear')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('avgAll')} style={thBtn}>Ср/день всего {sortIndicator('avgAll')}</button></th>
                  <th style={th}><button type="button" onClick={() => toggleSort('streak')} style={thBtn}>Серия {sortIndicator('streak')}</button></th>

                  <th style={th}>Действия</th>
                </tr>
              </thead>

              <tbody>
                {sortedAll.map((row: any) => {
                  const isMe = !!row.isMe;

                  const s: Stats = isMe ? myStats : row.stats;
                  const uname = isMe ? 'Ты' : row.friend.username;

                  const dToday = deltaMyMinusFriend(myStats.totalToday, s.totalToday);
                  const dAll = deltaMyMinusFriend(myStats.totalAll, s.totalAll);
                  const dYear = deltaMyMinusFriend(myStats.totalYear, s.totalYear);
                  const dMonth = deltaMyMinusFriend(myStats.totalMonth, s.totalMonth);
                  const dWeek = deltaMyMinusFriend(myStats.totalWeek, s.totalWeek);

                  return (
                    <tr key={isMe ? '__me__' : row.friend.friendshipId}>
                      <td style={td} className="table-sticky-first">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <AvatarCircle src={isMe ? me?.avatarPath : row.friend.avatarPath} size={28} />
                          <div style={{ fontWeight: 900 }}>{uname}</div>
                        </div>
                        {!isMe ? (
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            с {new Date(row.friend.since).toLocaleDateString()}
                          </div>
                        ) : (
                          <div style={{ fontSize: 12, opacity: 0.8 }}>—</div>
                        )}
                      </td>

                      <td style={tdNum}>{s.totalToday}</td>
                      <td style={tdNum}>
                        {isMe ? '—' : <span style={deltaStyle(dToday)}>{dToday}</span>}
                      </td>

                      <td style={tdNum}>{s.totalAll}</td>
                      <td style={tdNum}>
                        {isMe ? '—' : <span style={deltaStyle(dAll)}>{dAll}</span>}
                      </td>

                      <td style={tdNum}>{s.totalYear}</td>
                      <td style={tdNum}>
                        {isMe ? '—' : <span style={deltaStyle(dYear)}>{dYear}</span>}
                      </td>

                      <td style={tdNum}>{s.totalMonth}</td>
                      <td style={tdNum}>
                        {isMe ? '—' : <span style={deltaStyle(dMonth)}>{dMonth}</span>}
                      </td>

                      <td style={tdNum}>{s.totalWeek}</td>
                      <td style={tdNum}>
                        {isMe ? '—' : <span style={deltaStyle(dWeek)}>{dWeek}</span>}
                      </td>

                      <td style={tdNum}>{s.avgPerDayMonth || '-'}</td>
                      <td style={tdNum}>{s.avgPerDayYear || '-'}</td>
                      <td style={tdNum}>{s.avgPerDayAll || '-'}</td>
                      <td style={tdNum}>{s.streak}</td>

                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {isMe ? (
                          '—'
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRemoveFriend(row.friend.friendshipId, row.friend.username)}
                            style={btnDanger}
                          >
                            Удалить
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

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>Тренировки друга</h2>

        {friends.length === 0 ? (
          <p>Пока друзей нет.</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end', marginBottom: 12 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>Выбери друга</label>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <AvatarCircle src={selectedFriendObj?.avatarPath} size={34} />
<select
                  value={selectedFriend}
                  onChange={(e) => setSelectedFriend(e.target.value)}
                  style={{ padding: 8, borderRadius: 8, border: '1px solid #ccc', width: 220 }}
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
                Показаны только записи по упражнению: <b>{exerciseLabel}</b>
              </div>
            </div>

            {selectedFriendWorkouts.length === 0 ? (
              <p>Нет записей для выбранного друга по этому упражнению.</p>
            ) : (
              <div style={{ maxHeight: 420, overflow: 'auto', border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 520 }}>
                  <thead>
                    <tr style={{ background: '#f3f4f6' }}>
                      <th style={th}>Дата</th>
                      <th style={th}>Время</th>
                      <th style={{ ...th, textAlign: 'right' }}>Повторения</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedFriendWorkouts.map((w) => (
                      <tr key={w.id}>
                        <td style={td}>{new Date(w.date).toLocaleDateString()}</td>
                        <td style={td}>{formatTimeHHMM(w.time || w.date)}</td>
                        <td style={tdNum}>{w.reps}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
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

const btnPrimary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 10,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#fff',
  fontWeight: 900,
  cursor: 'pointer',
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

const tdNum: React.CSSProperties = {
  ...td,
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: '#000',
};
