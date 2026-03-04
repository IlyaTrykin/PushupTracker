'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type ProgressRow = { userId: string; username: string; total: number; creditedDays?: number; totalDays?: number; qualifiedSets?: number; qualifiedReps?: number };

type Challenge = {
  id: string;
  name: string;
  exerciseType: string;
  mode: 'most' | 'target' | 'daily_min' | 'sets_min';
  targetReps: number | null;
  startDate: string;
  endDate: string;
  createdAt: string;
  creator: { username: string };
  participants: { userId: string; user: { username: string } }[];
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

function statusLabel(startISO: string, endISO: string) {
  const now = new Date();
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (now < start) return { text: 'Ещё не начался', color: '#6b7280' as const };
  if (now > end) return { text: 'Завершён', color: '#6b7280' as const };
  return { text: 'Идёт', color: '#16a34a' as const };
}

function pct(total: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((total / target) * 100));
}

export default function ChallengeDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const [id, setId] = useState<string>('');
  const [me, setMe] = useState<{ id: string; username: string } | null>(null);

  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [progress, setProgress] = useState<ProgressRow[]>([]);

  const progressSorted = useMemo(() => {
    return [...(progress || [])].sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      return a.username.localeCompare(b.username, 'ru');
    });
  }, [progress]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    params.then((p) => mounted && setId(p.id));
    return () => { mounted = false; };
  }, [params]);

  const load = async (challengeId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [meData, chData] = await Promise.all([
        fetchJsonSafe('/api/me'),
        fetchJsonSafe(`/api/challenges/${challengeId}`),
      ]);
      // /api/me returns user fields at the root level
      setMe(meData?.id ? { id: meData.id, username: meData.username } : null);
      setChallenge(chData.challenge);
      setProgress(chData.progress || []);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!id) return;
    load(id);
  }, [id]);

  const meta = useMemo(() => {
    if (!challenge) return null;
    const st = statusLabel(challenge.startDate, challenge.endDate);
    const start = new Date(challenge.startDate);
    const end = new Date(challenge.endDate);

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const daysLeft = Math.max(0, Math.ceil((endDay.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));

    return { st, start, end, daysLeft };
  }, [challenge]);

  const leader = progressSorted.length ? progressSorted[0] : null;

  const myTotal = useMemo(() => {
    if (!me) return 0;
    return progressSorted.find(p => p.userId === me.id)?.total ?? 0;
  }, [me, progress]);

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>Соревнование</h1>
        <Link href="/challenges" style={{ textDecoration: 'none' }}>← Назад</Link>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p>Загрузка…</p>}

      {challenge && meta && (
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{challenge.name}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>
                {meta.start.toLocaleDateString()} → {meta.end.toLocaleDateString()} · создатель: {challenge.creator.username}
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Статус: <span style={{ color: meta.st.color, fontWeight: 800 }}>{meta.st.text}</span>
                {' · '}
                Осталось дней: <b>{meta.daysLeft}</b>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                Режим: <b>{challenge.mode === 'most' ? 'кто больше' : `цель ${challenge.targetReps}`}</b>
              </div>
            </div>

            {leader && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>Лидер</div>
                <div style={{ fontWeight: 900 }}>{leader.username}</div>
                <div style={{ fontWeight: 900 }}>{leader.total}</div>
              </div>
            )}
          </div>
        </section>
      )}

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Прогресс</h2>
          <button type="button" onClick={() => id && load(id)} style={btnSecondary}>Обновить</button>
        </div>

        {progress.length === 0 ? (
          <p style={{ marginTop: 12 }}>Пока нет данных.</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: 'max-content', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={thTiny}>#</th>
                  <th style={thBase}>Участник</th>
                  <th style={thNum}>{challenge?.mode === 'daily_min' ? 'Дни' : challenge?.mode === 'sets_min' ? 'Подходы' : 'Сумма'}</th>
                  {challenge?.mode === 'sets_min' ? <th style={thNum}>Повторы (зачт.)</th> : null}
                  <th style={thNum}>%</th>
                  <th style={thNum}>Осталось</th>
                  <th style={{ ...thClamp2, textAlign: 'right' }}>Дельта (я vs он)</th>
                </tr>
              </thead>
              <tbody>
                {progressSorted.map((p, idx) => {
                  const isMe = me?.id === p.userId;

                  const isTarget = challenge?.mode === 'target' && Number.isFinite(challenge?.targetReps ?? 0);
                  const target = isTarget ? (challenge!.targetReps as number) : 0;

                  const percent = isTarget ? pct(p.total, target) : null;
                  const remaining = isTarget ? Math.max(0, target - p.total) : null;

                  // delta = myTotal - hisTotal
                  const delta = isMe ? null : (myTotal - p.total);
                  const deltaText =
                    delta === null ? '—' :
                    delta < 0 ? String(delta) : String(delta); // will format sign below
                  const deltaColor =
                    delta === null ? '#6b7280' :
                    delta < 0 ? '#dc2626' : '#16a34a';

                  const deltaShown =
                    delta === null ? '—' :
                    delta < 0 ? `${delta}` : `${delta}`.replace(/^\+/, '');

                  return (
                    <tr key={p.userId}>
                      <td style={tdTiny}>{idx + 1}</td>
                      <td style={tdBase}>
                        <b style={{ color: idx === 0 ? '#d4af37' : (idx === 1 ? '#c0c0c0' : (idx === 2 ? '#cd7f32' : '#000')) }}>{p.username}</b>{isMe ? ' (я)' : ''}
                      </td>
                                            <td style={tdNum}>
                        {challenge?.mode === 'daily_min'
                          ? `${p.creditedDays ?? p.total}/${p.totalDays ?? ''}`
                          : p.total}
                      </td>
                      {challenge?.mode === 'sets_min' ? (
                        <td style={tdNum}>{Number(p.qualifiedReps ?? 0)}</td>
                      ) : null}
                      <td style={tdNum}>
                        {percent === null ? '—' : `${percent}%`}
                      </td>
                      <td style={tdNum}>
                        {remaining === null ? '—' : remaining}
                      </td>
                      <td style={{ ...tdNum, color: deltaColor }}>
                        {deltaShown}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {challenge?.mode === 'target' && typeof challenge.targetReps === 'number' && (
              <p style={{ marginTop: 10, color: '#6b7280', fontSize: 12 }}>
                Для режима “цель” % считается как total / targetReps.
              </p>
            )}
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

const btnSecondary: React.CSSProperties = {
  padding: '9px 12px',
  borderRadius: 8,
  border: '1px solid #d1d5db',
  background: '#fff',
  cursor: 'pointer',
  fontWeight: 700,
};

const thBase: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 6px',
  borderBottom: '1px solid #e5e7eb',
  fontSize: 12,
  color: '#374151',
  lineHeight: 1.2,
};

const thClamp2: React.CSSProperties = {
  ...thBase,
  whiteSpace: 'normal',
  maxWidth: 120,
  overflow: 'hidden',
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
};

const thNum: React.CSSProperties = {
  ...thBase,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  width: '1%',
};

const thTiny: React.CSSProperties = {
  ...thBase,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  width: '1%',
};

const tdBase: React.CSSProperties = {
  padding: '8px 6px',
  borderBottom: '1px solid #f1f5f9',
  fontSize: 14,
};

const tdNum: React.CSSProperties = {
  ...tdBase,
  textAlign: 'right',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};

const tdTiny: React.CSSProperties = {
  ...tdBase,
  textAlign: 'center',
  whiteSpace: 'nowrap',
  fontVariantNumeric: 'tabular-nums',
};
