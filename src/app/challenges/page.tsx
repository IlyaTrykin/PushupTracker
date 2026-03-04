'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type Friend = {
  friendshipId: string;
  username: string;
  since: string;
};

type ChallengeListItem = {
  id: string;
  name: string;
  exerciseType: string;
  mode: 'most' | 'target' | 'daily_min' | 'sets_min';
  targetReps: number | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  creatorId?: string;
  creator: { username: string };
  myStatus?: 'pending' | 'accepted' | null;
  participants: { userId?: string; status?: 'pending' | 'accepted'; user: { username: string } }[];
};

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch {}
  }
  if (!res.ok) {
    const base = data?.error || `Ошибка (код ${res.status})`;
    const details = data?.details || '';
    throw new Error(details ? `${base}: ${details}` : base);
  }
  return data;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function endOfMonthISO() {
  const d = new Date();
  const end = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  const y = end.getFullYear();
  const m = String(end.getMonth() + 1).padStart(2, '0');
  const dd = String(end.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}


function challengeStatus(startISO: string, endISO: string) {
  const now = new Date();
  const start = new Date(startISO);
  const end = new Date(endISO);
  const active = now >= start && now <= end;
  const finished = now > end;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const daysLeft = Math.max(0, Math.ceil((endDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

  return { active, finished, daysLeft, start, end };
}
function badge(text: string, tone: 'gray' | 'green' | 'amber' | 'red') {
  const bg = tone === 'green' ? '#dcfce7' : tone === 'amber' ? '#fef3c7' : tone === 'red' ? '#fee2e2' : '#f3f4f6';
  const fg = tone === 'green' ? '#166534' : tone === 'amber' ? '#92400e' : tone === 'red' ? '#991b1b' : '#374151';
  return (
    <span style={{
      padding: '2px 8px',
      borderRadius: 999,
      background: bg,
      color: fg,
      fontSize: 12,
      fontWeight: 800,
      whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

export default function ChallengesPage() {
  const [friends, setFriends] = useState<Friend[]>([]);
  const [challenges, setChallenges] = useState<ChallengeListItem[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState('Соревнование месяца');
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(endOfMonthISO());
  const [exerciseType, setExerciseType] = useState<'pushups' | 'pullups' | 'crunches' | 'squats'>('pushups');
  const [mode, setMode] = useState<'most' | 'target' | 'daily_min' | 'sets_min'>('most');
  const [targetReps, setTargetReps] = useState<number>(1000);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      const fr = await fetchJsonSafe('/api/friends');
      setFriends(fr || []);
      const ch = await fetchJsonSafe('/api/challenges');
      setChallenges(ch || []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const selectedUsernames = useMemo(() => {
    return friends.filter(f => selected[f.username]).map(f => f.username);
  }, [friends, selected]);

  const invites = useMemo(() => {
    return (challenges || []).filter(c => c.myStatus === 'pending');
  }, [challenges]);

  const acceptedChallenges = useMemo(() => {
    return (challenges || []).filter(c => c.myStatus !== 'pending');
  }, [challenges]);

  const activeChallenges = useMemo(() => {
    const arr = acceptedChallenges.filter((c) => challengeStatus(c.startDate, c.endDate).active);
    return arr.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  }, [acceptedChallenges]);

  const historyChallenges = useMemo(() => {
    const arr = acceptedChallenges.filter((c) => challengeStatus(c.startDate, c.endDate).finished);
    return arr.sort((a, b) => new Date(b.endDate).getTime() - new Date(a.endDate).getTime());
  }, [acceptedChallenges]);

  const createChallenge = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    try {
      await fetchJsonSafe('/api/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          exerciseType,
          startDate,
          endDate,
          mode,
          targetReps: (mode === 'target' || mode === 'daily_min' || mode === 'sets_min') ? targetReps : undefined,
          participantsUsernames: selectedUsernames,
        }),
      });

      setInfo('Соревнование создано');
      setSelected({});
      setShowCreate(false);
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const deleteChallenge = async (id: string) => {
    const ok = window.confirm('Удалить соревнование?');
    if (!ok) return;

    setError(null);
    setInfo(null);

    try {
      await fetchJsonSafe(`/api/challenges/${id}`, { method: 'DELETE' });
      setInfo('Удалено');
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const acceptInvite = async (id: string) => {
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/challenges/${id}/accept`, { method: 'POST' });
      setInfo('Приглашение принято');
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  const declineInvite = async (id: string) => {
    const ok = window.confirm('Отклонить приглашение?');
    if (!ok) return;

    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/challenges/${id}/decline`, { method: 'POST' });
      setInfo('Приглашение отклонено');
      await loadAll();
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 12 }}>
        <button type="button" style={btnPrimary} onClick={() => setShowCreate(v => !v)}>
          {showCreate ? 'Скрыть' : 'Создать соревнование'}
        </button>
      </div>

      {showCreate ? (
        <section style={card}>
          <form onSubmit={createChallenge} style={{ display: 'grid', gap: 10, maxWidth: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>Название</label>
                <input value={name} onChange={e => setName(e.target.value)} style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>Старт</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>Финиш</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={input} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, alignItems: 'end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>Режим</label>
                <select value={mode} onChange={e => setMode(e.target.value as any)} style={input}>
                  <option value="most">Кто больше за период</option>
                  <option value="target">Цель (N повторов)</option>
                  <option value="daily_min">Зачтённые дни (мин. X в день)</option>
                  <option value="sets_min">Зачтённые подходы (reps ≥ X)</option>
                </select>
              </div>

              {mode === 'target' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label>Цель (повторы)</label>
                  <input
                    type="number"
                    min={1}
                    value={targetReps}
                    onChange={e => setTargetReps(Number(e.target.value))}
                    style={input}
                  />
                </div>
              ) : mode === 'daily_min' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label>Минимум повторов в день (X)</label>
                  <input
                    type="number"
                    min={1}
                    value={targetReps}
                    onChange={e => setTargetReps(Number(e.target.value))}
                    style={input}
                  />
                </div>
              ) : mode === 'sets_min' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label>Минимум повторов для зачёта подхода (X)</label>
                  <input
                    type="number"
                    min={1}
                    value={targetReps}
                    onChange={e => setTargetReps(Number(e.target.value))}
                    style={input}
                  />
                </div>
              ) : (
                <div style={{ color: '#6b7280', fontSize: 12 }}>
                  В этом режиме цель не задаётся — считаем сумму за период.
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label>Упражнение</label>
              <select value={exerciseType} onChange={e => setExerciseType(e.target.value as any)} style={input}>
                <option value="pushups">Отжимания</option>
                <option value="pullups">Подтягивания</option>
                <option value="crunches">Скручивания</option>
                <option value="squats">Приседания</option>
              </select>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Участники (друзья)</div>
              {friends.length === 0 ? (
                <div style={{ color: '#6b7280' }}>Друзей пока нет.</div>
              ) : (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                  {friends.map(f => (
                    <label key={f.friendshipId} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={!!selected[f.username]}
                        onChange={(e) => setSelected(prev => ({ ...prev, [f.username]: e.target.checked }))}
                      />
                      {f.username}
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button type="submit" style={btnPrimary}>Создать</button>
              <button type="button" onClick={loadAll} style={btnSecondary}>Обновить</button>
            </div>
          </form>
        </section>
      ) : null}

      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      {info && <p style={{ color: 'green', marginTop: 12 }}>{info}</p>}
      {loading && <p style={{ marginTop: 12 }}>Загрузка…</p>}

      {activeChallenges.length > 0 ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Соревнования</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {activeChallenges.map(c => {
              const st = challengeStatus(c.startDate, c.endDate);
              const warn = st.daysLeft < 3 ? badge(`осталось ${st.daysLeft} дн.`, 'amber') : null;
              return (
                <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{c.name}</span>
                        {badge('идёт', 'green')}
                        {warn ? <span style={{ marginLeft: 6 }}>{warn}</span> : null}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 12 }}>
                        {new Date(c.startDate).toLocaleDateString()} → {new Date(c.endDate).toLocaleDateString()} · создатель: {c.creator.username}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link href={`/challenges/${c.id}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                        Открыть
                      </Link>
                      <button type="button" style={btnDanger} onClick={() => deleteChallenge(c.id)}>Удалить</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {invites.length > 0 ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>Приглашения</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {invites.map(c => (
              <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>{c.name}</span>
                      {badge('Ожидает ответа', 'amber')}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                      {new Date(c.startDate).toLocaleDateString()} → {new Date(c.endDate).toLocaleDateString()} · создатель: {c.creator.username}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" style={btnPrimary} onClick={() => acceptInvite(c.id)}>Принять</button>
                    <button type="button" style={btnDanger} onClick={() => declineInvite(c.id)}>Отклонить</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>История</h2>

        {historyChallenges.length === 0 ? (
          <p>Пока завершённых соревнований нет.</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {historyChallenges.map(c => {
              return (
                <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{c.name}</span>
                        {badge('завершён', 'red')}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 12 }}>
                        {new Date(c.startDate).toLocaleDateString()} → {new Date(c.endDate).toLocaleDateString()} · создатель: {c.creator.username}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link href={`/challenges/${c.id}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                        Открыть
                      </Link>
                      <button type="button" style={btnDanger} onClick={() => deleteChallenge(c.id)}>Удалить</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
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

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  minWidth: 0,
  padding: 8,
  borderRadius: 6,
  border: '1px solid #ccc',
};

const btnPrimary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};

const btnSecondary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
};

const btnDanger: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: 'none',
  backgroundColor: '#dc2626',
  color: '#fff',
  fontWeight: 700,
  cursor: 'pointer',
};
