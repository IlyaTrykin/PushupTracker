'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '@/i18n/provider';
import { getIntlLocale, t } from '@/i18n/translate';

type TrainingSet = {
  id: string;
  setNumber: number;
  targetReps: number;
  actualReps: number | null;
  isKeySet: boolean;
};

type TrainingSession = {
  id: string;
  weekNumber: number;
  sessionNumber: number;
  scheduledAt: string;
  completed: boolean;
  completedAt: string | null;
  isFinalTest?: boolean;
  sets: TrainingSet[];
};

type ProgramStats = {
  totalSessions: number;
  completedSessions: number;
  completionPercent: number;
};

type ProgramDetail = {
  id: string;
  exerciseType: string;
  targetReps: number | null;
  baselineMaxReps: number;
  durationWeeks: number;
  frequencyPerWeek: number;
  status: string;
  sessions: TrainingSession[];
  stats: ProgramStats;
};

async function fetchJson(url: string) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {}
  }
  if (!res.ok) throw new Error(data?.error || `Ошибка (код ${res.status})`);
  return data;
}

function exerciseLabel(exerciseType: string) {
  if (exerciseType === 'pushups') return 'Отжимания';
  if (exerciseType === 'pullups') return 'Подтягивания';
  if (exerciseType === 'crunches') return 'Скручивания';
  if (exerciseType === 'squats') return 'Приседания';
  return exerciseType;
}

function formatSessionDate(iso: string, locale: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function renderSetPlan(session: TrainingSession) {
  return session.sets
    .slice()
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((set) => (set.isKeySet && !session.isFinalTest ? 'max' : String(set.targetReps)))
    .join('-');
}

export default function ProgramDetailPage() {
  const params = useParams<{ id: string }>();
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = (input: string) => t(locale, input);
  const programId = String(params?.id || '');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [program, setProgram] = useState<ProgramDetail | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);

  useEffect(() => {
    if (!programId) return;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = (await fetchJson(`/api/program/${programId}`)) as ProgramDetail;
        if (!cancelled) setProgram(data);
      } catch (e: any) {
        if (!cancelled) setError(tt(e?.message || 'Не удалось загрузить программу'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [programId]);

  const upcomingSessions = useMemo(
    () => (program?.sessions || []).filter((s) => !s.completed),
    [program],
  );

  const completedSessions = useMemo(
    () => (program?.sessions || []).filter((s) => s.completed),
    [program],
  );

  const sessionsToShow = showCompleted ? completedSessions : upcomingSessions;

  return (
    <div className="app-page" style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <Link href="/program" style={btnLink}>← {tt('К программам')}</Link>
      </div>

      {loading ? <p>{tt('Загрузка…')}</p> : null}
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}

      {program && !loading ? (
        <>
          <section style={card}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div>{tt('Упражнение')}: <b>{tt(exerciseLabel(program.exerciseType))}</b></div>
              <div>{tt('Базовый тест')}: <b>{program.baselineMaxReps}</b> · {tt('Цель')}: <b>{program.targetReps ?? '—'}</b></div>
              <div>{tt('Длительность')}: <b>{program.durationWeeks}</b> {tt('нед')} · {tt('Темп')}: <b>{program.frequencyPerWeek}</b>/{tt('нед')}</div>
              <div>{tt('Прогресс')}: <b>{program.stats.completedSessions}/{program.stats.totalSessions}</b> ({program.stats.completionPercent}%)</div>
            </div>
          </section>

          <section style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h2 style={{ margin: 0 }}>{showCompleted ? tt('Выполненные тренировки') : tt('Предстоящие тренировки')}</h2>
              <button type="button" style={btnSecondary} onClick={() => setShowCompleted((x) => !x)}>
                {showCompleted ? tt('Показать предстоящие') : tt('Показать выполненные')}
              </button>
            </div>

            <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
              {sessionsToShow.length === 0 ? (
                <div style={{ color: '#6b7280' }}>
                  {showCompleted ? tt('Выполненных тренировок пока нет.') : tt('Предстоящих тренировок нет.')}
                </div>
              ) : sessionsToShow.map((session) => (
                <div key={session.id} style={rowCard}>
                  <div style={{ display: 'grid', gap: 4 }}>
                    <div style={{ fontWeight: 900 }}>
                      {formatSessionDate(session.scheduledAt, localeTag)} · #{session.sessionNumber}
                      {session.isFinalTest ? ` · ${tt('финальный тест')}` : ''}
                    </div>
                    <div style={{ color: '#111827' }}>
                      {tt('План подходов')}: <b>{renderSetPlan(session)}</b>
                    </div>
                    <div style={{ color: '#111827' }}>
                      {tt('Статус')}: {session.completed ? tt('Выполнено') : tt('Запланировано')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!session.completed ? (
                      <Link href={`/program/session/${session.id}`} style={btnPrimaryLink}>
                        {tt('Приступить')}
                      </Link>
                    ) : (
                      <span style={doneBadge}>{tt('Выполнено')}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

const card: React.CSSProperties = {
  marginTop: 14,
  border: '1px solid #e5e7eb',
  borderRadius: 12,
  background: '#f9fafb',
  padding: 14,
};

const rowCard: React.CSSProperties = {
  border: '1px solid #e5e7eb',
  borderRadius: 10,
  background: '#fff',
  padding: 10,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
};

const btnSecondary: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#fff',
  color: '#111827',
  fontWeight: 800,
  cursor: 'pointer',
};

const btnLink: React.CSSProperties = {
  border: '1px solid #d1d5db',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#fff',
  color: '#111827',
  fontWeight: 800,
  textDecoration: 'none',
};

const btnPrimaryLink: React.CSSProperties = {
  border: 'none',
  borderRadius: 10,
  padding: '9px 12px',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 900,
  textDecoration: 'none',
  display: 'inline-flex',
  alignItems: 'center',
};

const doneBadge: React.CSSProperties = {
  borderRadius: 999,
  padding: '5px 10px',
  background: '#dcfce7',
  color: '#166534',
  fontWeight: 900,
  fontSize: 12,
};
