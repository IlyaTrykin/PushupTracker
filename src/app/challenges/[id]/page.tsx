'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useI18n } from '@/i18n/provider';
import { useRouteParam } from '@/lib/use-route-param';
import { getIntlLocale, t } from '@/i18n/translate';
import { challengesMessages } from '@/i18n/messages/features/challenges';
import {
  challengeMostLabel,
  challengeQualifiedValueLabel,
  formatExerciseValue,
  isTimedExercise,
} from '@/lib/exercise-metrics';
import { dayKeyInZone } from '@/lib/calendar-day';
import { challengeDayStatus, challengeUsesPoints, formatChallengeDay } from '@/lib/challenge-scoring';

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

type JsonObject = Record<string, unknown>;

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function fetchJsonSafe(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: JsonObject | null = null;
  if (text) {
    try {
      const parsed = JSON.parse(text);
      data = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
    } catch {}
  }
  if (!res.ok) {
    const base = typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`;
    const details = typeof data?.details === 'string' ? data.details : '';
    throw new Error(details ? `${base}: ${details}` : base);
  }
  return data;
}

// Статус по календарным дням (B09): последний день челленджа — ещё «Идёт».
function statusLabel(status: ReturnType<typeof challengeDayStatus>) {
  if (status.upcoming) return { text: 'Ещё не начался', color: '#6b7280' as const };
  if (status.finished) return { text: 'Завершён', color: '#6b7280' as const };
  return { text: 'Идёт', color: '#16a34a' as const };
}

const roundTenth = (value: number) => Math.round(value * 10) / 10;

function pct(total: number, target: number) {
  if (target <= 0) return 0;
  return Math.min(100, Math.round((total / target) * 100));
}

export default function ChallengeDetailsPage() {
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = (input: string) => t(locale, input);
  const id = useRouteParam('id') || '';
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

  const load = useCallback(async (challengeId: string) => {
    setLoading(true);
    setError(null);
    try {
      const [meData, chData] = await Promise.all([
        fetchJsonSafe('/api/me'),
        fetchJsonSafe(`/api/challenges/${challengeId}`),
      ]);
      // /api/me returns user fields at the root level
      setMe(typeof meData?.id === 'string' && typeof meData.username === 'string' ? { id: meData.id, username: meData.username } : null);
      setChallenge((chData?.challenge as Challenge | undefined) ?? null);
      setProgress(Array.isArray(chData?.progress) ? (chData.progress as ProgressRow[]) : []);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!id) return;
    void load(id);
  }, [id, load]);

  const meta = useMemo(() => {
    if (!challenge) return null;
    const today = dayKeyInZone(new Date(), Intl.DateTimeFormat().resolvedOptions().timeZone);
    const status = challengeDayStatus(challenge.startDate, challenge.endDate, today);
    const st = statusLabel(status);
    return { st, daysLeft: status.daysLeft, usesPoints: challengeUsesPoints(challenge.exerciseType) };
  }, [challenge]);

  const leader = progressSorted.length ? progressSorted[0] : null;

  const myTotal = useMemo(() => {
    if (!me) return 0;
    return progressSorted.find(p => p.userId === me.id)?.total ?? 0;
  }, [me, progressSorted]);

  return (
    <div className="app-page" style={{ maxWidth: 900 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Link href="/challenges" style={{ textDecoration: 'none' }}>← {tt('Назад')}</Link>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}
      {loading && <p>{tt('Загрузка…')}</p>}

      {challenge && meta && (
        <section style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18 }}>{challenge.name}</div>
              <div style={{ color: '#6b7280', fontSize: 12 }}>
                {formatChallengeDay(challenge.startDate, localeTag)} → {formatChallengeDay(challenge.endDate, localeTag)} · {tt('создатель')}: {challenge.creator.username}
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>
                {tt('Статус')}: <span style={{ color: meta.st.color, fontWeight: 800 }}>{tt(meta.st.text)}</span>
                {' · '}
                {tt('Осталось дней')}: <b>{meta.daysLeft}</b>
              </div>
              <div style={{ marginTop: 6, fontSize: 12 }}>
                {tt('Режим')}: <b>{challenge.mode === 'most'
                  ? tt(challengeMostLabel(challenge.exerciseType))
                  : `${tt('цель')} ${formatExerciseValue(challenge.targetReps, challenge.exerciseType, true, locale)}`}</b>
              </div>
              {meta.usesPoints && challenge.mode !== 'sets_min' ? (
                <div style={{ marginTop: 6, fontSize: 12, color: '#6b7280' }}>
                  {challengesMessages[locale].pointsHintDetails}
                </div>
              ) : null}
            </div>

            {leader && (
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{tt('Лидер')}</div>
                <div style={{ fontWeight: 900 }}>{leader.username}</div>
                <div style={{ fontWeight: 900 }}>
                  {challenge.mode === 'most' || challenge.mode === 'target'
                    ? formatExerciseValue(leader.total, challenge.exerciseType, true, locale)
                    : leader.total}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      <section style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>{tt('Прогресс')}</h2>
          <button type="button" onClick={() => id && load(id)} style={btnSecondary}>{tt('Обновить')}</button>
        </div>

        {progress.length === 0 ? (
          <p style={{ marginTop: 12 }}>{tt('Пока нет данных.')}</p>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table style={{ width: 'max-content', borderCollapse: 'collapse', tableLayout: 'auto' }}>
              <thead>
                <tr style={{ background: '#f3f4f6' }}>
                  <th style={thTiny}>#</th>
                  <th style={thBase}>{tt('Участник')}</th>
                  <th style={thNum}>{challenge?.mode === 'daily_min' ? tt('Дни') : challenge?.mode === 'sets_min' ? tt('Подходы') : tt('Сумма')}</th>
                  {challenge?.mode === 'sets_min' ? <th style={thNum}>{tt(challengeQualifiedValueLabel(challenge.exerciseType))}</th> : null}
                  <th style={thNum}>%</th>
                  <th style={thNum}>{tt('Осталось')}</th>
                  <th style={{ ...thClamp2, textAlign: 'right' }}>{tt('Дельта (я vs он)')}</th>
                </tr>
              </thead>
              <tbody>
                {progressSorted.map((p, idx) => {
                  const isMe = me?.id === p.userId;

                  const isTarget = challenge?.mode === 'target' && Number.isFinite(challenge?.targetReps ?? 0);
                  const target = isTarget ? (challenge!.targetReps as number) : 0;

                  const percent = isTarget ? pct(p.total, target) : null;
                  const remaining = isTarget ? roundTenth(Math.max(0, target - p.total)) : null;

                  // delta = myTotal - hisTotal
                  const delta = isMe ? null : roundTenth(myTotal - p.total);
                  const deltaColor =
                    delta === null ? '#6b7280' :
                    delta < 0 ? '#dc2626' : '#16a34a';

                  const deltaShown =
                    delta === null ? '—' :
                    challenge?.mode === 'most' || challenge?.mode === 'target'
                      ? (delta < 0
                        ? `-${formatExerciseValue(Math.abs(delta), challenge.exerciseType, true, locale)}`
                        : formatExerciseValue(delta, challenge.exerciseType, true, locale))
                      : (delta < 0 ? `${delta}` : `${delta}`.replace(/^\+/, ''));

                  return (
                    <tr key={p.userId}>
                      <td style={tdTiny}>{idx + 1}</td>
                      <td style={tdBase}>
                        <b style={{ color: idx === 0 ? '#d4af37' : (idx === 1 ? '#c0c0c0' : (idx === 2 ? '#cd7f32' : '#000')) }}>{p.username}</b>{isMe ? ` ${tt('(я)')}` : ''}
                      </td>
                      <td style={tdNum}>
                        {challenge?.mode === 'daily_min'
                          ? `${p.creditedDays ?? p.total}/${p.totalDays ?? ''}`
                          : formatExerciseValue(p.total, challenge?.mode === 'sets_min' ? null : challenge?.exerciseType, challenge?.mode !== 'sets_min', locale)}
                      </td>
                      {challenge?.mode === 'sets_min' ? (
                        <td style={tdNum}>{formatExerciseValue(Number(p.qualifiedReps ?? 0), challenge?.exerciseType, true, locale)}</td>
                      ) : null}
                      <td style={tdNum}>
                        {percent === null ? '—' : `${percent}%`}
                      </td>
                      <td style={tdNum}>
                        {remaining === null ? '—' : formatExerciseValue(remaining, challenge?.exerciseType, true, locale)}
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
                {tt(isTimedExercise(challenge?.exerciseType)
                  ? 'Для режима “цель” % считается как totalSeconds / targetSeconds.'
                  : 'Для режима “цель” % считается как total / targetReps.')}
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
