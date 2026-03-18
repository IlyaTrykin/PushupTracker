'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';
import {
  challengeDailyMinLabel,
  challengeMostLabel,
  challengeSetsMinLabel,
  challengeSetsModeLabel,
  challengeTargetLabel,
  challengeTargetPromptLabel,
} from '@/lib/exercise-metrics';

type Friend = {
  friendshipId: string;
  username: string;
  since: string;
};
type ChallengeMode = 'most' | 'target' | 'daily_min' | 'sets_min';
type ExerciseType = 'pushups' | 'pullups' | 'crunches' | 'squats' | 'plank';

type ChallengeListItem = {
  id: string;
  name: string;
  exerciseType: string;
  mode: ChallengeMode;
  targetReps: number | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  creatorId?: string;
  creator: { username: string };
  myStatus?: 'pending' | 'accepted' | 'declined' | null;
  participants: { userId?: string; status?: 'pending' | 'accepted' | 'declined'; user: { username: string } }[];
};

type JsonObject = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    ...init,
  });
  const text = await res.text();
  let data: JsonObject | null = null;
  if (text) {
    try { data = JSON.parse(text) as JsonObject; } catch {}
  }
  if (!res.ok) {
    const base = typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`;
    const details = typeof data?.details === 'string' ? data.details : '';
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

function isChallengeMode(value: string): value is ChallengeMode {
  return ['most', 'target', 'daily_min', 'sets_min'].includes(value);
}

function isExerciseType(value: string): value is ExerciseType {
  return ['pushups', 'pullups', 'crunches', 'squats', 'plank'].includes(value);
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
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const [friends, setFriends] = useState<Friend[]>([]);
  const [challenges, setChallenges] = useState<ChallengeListItem[]>([]);
  const [meId, setMeId] = useState<string>('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [showCreate, setShowCreate] = useState(false);

  const [name, setName] = useState(() => t(locale, 'Соревнование месяца'));
  const [startDate, setStartDate] = useState(todayISO());
  const [endDate, setEndDate] = useState(endOfMonthISO());
  const [exerciseType, setExerciseType] = useState<ExerciseType>('pushups');
  const [mode, setMode] = useState<ChallengeMode>('most');
  const [targetReps, setTargetReps] = useState<number>(1000);

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadAll = useCallback(async ({
    showLoading = true,
    resetInfo = true,
  }: {
    showLoading?: boolean;
    resetInfo?: boolean;
  } = {}) => {
    if (showLoading) setLoading(true);
    setError(null);
    if (resetInfo) setInfo(null);
    try {
      const [me, fr, ch] = await Promise.all([
        fetchJsonSafe('/api/me'),
        fetchJsonSafe('/api/friends'),
        fetchJsonSafe('/api/challenges'),
      ]);
      setMeId(typeof me?.id === 'string' ? me.id : '');
      setFriends(Array.isArray(fr) ? (fr as Friend[]) : []);
      setChallenges(Array.isArray(ch) ? (ch as ChallengeListItem[]) : []);
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    } finally {
      if (showLoading) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void loadAll({ showLoading: false, resetInfo: false });
      }
    }, 3000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadAll({ showLoading: false, resetInfo: false });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [loadAll]);

  useEffect(() => {
    setName((prev) => {
      if (!prev || prev === 'Соревнование месяца' || prev === 'Challenge of the month') {
        return tt('Соревнование месяца');
      }
      return prev;
    });
  }, [tt]);

  const selectedUsernames = useMemo(() => {
    return friends.filter(f => selected[f.username]).map(f => f.username);
  }, [friends, selected]);

  const invites = useMemo(() => {
    return (challenges || []).filter(c => c.myStatus === 'pending');
  }, [challenges]);

  const pendingConfirmationChallenges = useMemo(() => {
    return (challenges || [])
      .filter((c) => c.creatorId === meId && c.participants.some((p) => p.userId !== meId && p.status === 'pending'))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [challenges, meId]);

  const acceptedChallenges = useMemo(() => {
    return (challenges || []).filter((c) => {
      if (c.myStatus !== 'accepted') return false;
      if (c.creatorId === meId && c.participants.some((p) => p.userId !== meId && p.status === 'pending')) return false;
      return true;
    });
  }, [challenges, meId]);

  const visibleChallenges = useMemo(() => {
    const arr = acceptedChallenges.filter((c) => !challengeStatus(c.startDate, c.endDate).finished);
    return arr.sort((a, b) => {
      const aStatus = challengeStatus(a.startDate, a.endDate);
      const bStatus = challengeStatus(b.startDate, b.endDate);

      if (aStatus.active !== bStatus.active) return aStatus.active ? -1 : 1;
      if (!aStatus.active && !bStatus.active) {
        return new Date(a.startDate).getTime() - new Date(b.startDate).getTime();
      }
      return new Date(a.endDate).getTime() - new Date(b.endDate).getTime();
    });
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

      setInfo(tt('Соревнование создано'));
      setSelected({});
      setShowCreate(false);
      await loadAll({ showLoading: false, resetInfo: false });
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  const deleteChallenge = async (id: string) => {
    const ok = window.confirm(tt('Удалить соревнование?'));
    if (!ok) return;

    setError(null);
    setInfo(null);

    try {
      await fetchJsonSafe(`/api/challenges/${id}`, { method: 'DELETE' });
      setInfo(tt('Удалено'));
      await loadAll({ showLoading: false, resetInfo: false });
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  const acceptInvite = async (id: string) => {
    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/challenges/${id}/accept`, { method: 'POST' });
      setInfo(tt('Приглашение принято'));
      await loadAll({ showLoading: false, resetInfo: false });
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  const declineInvite = async (id: string) => {
    const ok = window.confirm(tt('Отклонить приглашение?'));
    if (!ok) return;

    setError(null);
    setInfo(null);
    try {
      await fetchJsonSafe(`/api/challenges/${id}/decline`, { method: 'POST' });
      setInfo(tt('Приглашение отклонено'));
      await loadAll({ showLoading: false, resetInfo: false });
    } catch (e: unknown) {
      setError(getErrorMessage(e));
    }
  };

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <div style={{ marginBottom: 12 }}>
        <button type="button" style={btnPrimary} onClick={() => setShowCreate(v => !v)}>
          {showCreate ? tt('Скрыть') : tt('Создать соревнование')}
        </button>
      </div>

      {showCreate ? (
        <section style={card}>
          <form onSubmit={createChallenge} style={{ display: 'grid', gap: 10, maxWidth: '100%' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>{tt('Название')}</label>
                <input value={name} onChange={e => setName(e.target.value)} style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>{tt('Старт')}</label>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={input} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>{tt('Финиш')}</label>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={input} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, alignItems: 'end' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label>{tt('Режим')}</label>
                <select
                  value={mode}
                  onChange={e => {
                    const nextValue = e.target.value;
                    if (isChallengeMode(nextValue)) setMode(nextValue);
                  }}
                  style={input}
                >
                  <option value="most">{tt(challengeMostLabel(exerciseType))}</option>
                  <option value="target">{tt(challengeTargetPromptLabel(exerciseType))}</option>
                  <option value="daily_min">{tt('Зачтённые дни (мин. X в день)')}</option>
                  <option value="sets_min">{tt(challengeSetsModeLabel(exerciseType))}</option>
                </select>
              </div>

              {mode === 'target' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label>{tt(challengeTargetLabel(exerciseType))}</label>
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
                  <label>{tt(challengeDailyMinLabel(exerciseType))}</label>
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
                  <label>{tt(challengeSetsMinLabel(exerciseType))}</label>
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
                  {tt('В этом режиме цель не задаётся — считаем сумму за период.')}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label>{tt('Упражнение')}</label>
              <select
                value={exerciseType}
                onChange={e => {
                  const nextValue = e.target.value;
                  if (isExerciseType(nextValue)) setExerciseType(nextValue);
                }}
                style={input}
              >
                <option value="pushups">{tt('Отжимания')}</option>
                <option value="pullups">{tt('Подтягивания')}</option>
                <option value="crunches">{tt('Скручивания')}</option>
                <option value="squats">{tt('Приседания')}</option>
                <option value="plank">{tt('Планка')}</option>
              </select>
            </div>

            <div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>{tt('Участники (друзья)')}</div>
              {friends.length === 0 ? (
                <div style={{ color: '#6b7280' }}>{tt('Друзей пока нет.')}</div>
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
              <button type="submit" style={btnPrimary}>{tt('Создать')}</button>
              <button type="button" onClick={() => void loadAll()} style={btnSecondary}>{tt('Обновить')}</button>
            </div>
          </form>
        </section>
      ) : null}

      {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      {info && <p style={{ color: 'green', marginTop: 12 }}>{info}</p>}
      {loading && <p style={{ marginTop: 12 }}>{tt('Загрузка…')}</p>}

      {pendingConfirmationChallenges.length > 0 ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>{tt('Ожидают подтверждения')}</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {pendingConfirmationChallenges.map((c) => {
              const acceptedCount = c.participants.filter((p) => p.status === 'accepted').length;
              const pendingCount = c.participants.filter((p) => p.userId !== meId && p.status === 'pending').length;
              return (
                <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{c.name}</span>
                        {badge(tt('Ожидает подтверждения'), 'amber')}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                        {new Date(c.startDate).toLocaleDateString(localeTag)} → {new Date(c.endDate).toLocaleDateString(localeTag)} · {tt('создатель')}: {c.creator.username}
                      </div>
                      <div style={{ color: '#374151', fontSize: 12, marginTop: 6 }}>
                        {tt('Подтверждено')}: <b>{acceptedCount}</b> · {tt('Ожидает ответа')}: <b>{pendingCount}</b>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link href={`/challenges/${c.id}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                        {tt('Открыть')}
                      </Link>
                      <button type="button" style={btnDanger} onClick={() => deleteChallenge(c.id)}>{tt('Удалить')}</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {visibleChallenges.length > 0 ? (
        <section style={card}>
          <h2 style={{ marginTop: 0 }}>{tt('Соревнования')}</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {visibleChallenges.map(c => {
              const st = challengeStatus(c.startDate, c.endDate);
              const warn = st.active && st.daysLeft < 3 ? badge(tt(`осталось ${st.daysLeft} дн.`), 'amber') : null;
              return (
                <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{c.name}</span>
                        {st.active ? badge(tt('идёт'), 'green') : badge(tt('Ещё не начался'), 'gray')}
                        {warn ? <span style={{ marginLeft: 6 }}>{warn}</span> : null}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 12 }}>
                        {new Date(c.startDate).toLocaleDateString(localeTag)} → {new Date(c.endDate).toLocaleDateString(localeTag)} · {tt('создатель')}: {c.creator.username}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link href={`/challenges/${c.id}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                        {tt('Открыть')}
                      </Link>
                      <button type="button" style={btnDanger} onClick={() => deleteChallenge(c.id)}>{tt('Удалить')}</button>
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
          <h2 style={{ marginTop: 0 }}>{tt('Приглашения')}</h2>
          <div style={{ display: 'grid', gap: 10 }}>
            {invites.map(c => (
              <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span>{c.name}</span>
                      {badge(tt('Ожидает ответа'), 'amber')}
                    </div>
                    <div style={{ color: '#6b7280', fontSize: 12, marginTop: 4 }}>
                      {new Date(c.startDate).toLocaleDateString(localeTag)} → {new Date(c.endDate).toLocaleDateString(localeTag)} · {tt('создатель')}: {c.creator.username}
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button type="button" style={btnPrimary} onClick={() => acceptInvite(c.id)}>{tt('Принять')}</button>
                    <button type="button" style={btnDanger} onClick={() => declineInvite(c.id)}>{tt('Отклонить')}</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section style={card}>
        <h2 style={{ marginTop: 0 }}>{tt('История')}</h2>

        {historyChallenges.length === 0 ? (
          <p>{tt('Пока завершённых соревнований нет.')}</p>
        ) : (
          <div style={{ display: 'grid', gap: 10 }}>
            {historyChallenges.map(c => {
              return (
                <div key={c.id} style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 10, background: '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontWeight: 800, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span>{c.name}</span>
                        {badge(tt('завершён'), 'red')}
                      </div>
                      <div style={{ color: '#6b7280', fontSize: 12 }}>
                        {new Date(c.startDate).toLocaleDateString(localeTag)} → {new Date(c.endDate).toLocaleDateString(localeTag)} · {tt('создатель')}: {c.creator.username}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <Link href={`/challenges/${c.id}`} style={{ ...btnSecondary, textDecoration: 'none', display: 'inline-block' }}>
                        {tt('Открыть')}
                      </Link>
                      <button type="button" style={btnDanger} onClick={() => deleteChallenge(c.id)}>{tt('Удалить')}</button>
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
