'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BackButton } from '@/components/ui';
import { useI18n } from '@/i18n/provider';
import { programSessionHref } from '@/lib/app-routes';
import { getCircuitTemplate } from '@/lib/circuits';
import { useRouteParam } from '@/lib/use-route-param';
import { getIntlLocale, t } from '@/i18n/translate';
import { formatExerciseValue } from '@/lib/exercise-metrics';
import { exerciseLabel, programKind } from '@/lib/exercises';
import { programLabel, type ProgramSessionKind } from '@/lib/program-plan';
import { programsMessages } from '@/i18n/messages/features/programs';
import { circuitsMessages } from '@/i18n/messages/features/circuits';

type TrainingSet = {
  id: string;
  setNumber: number;
  targetReps: number;
  actualReps: number | null;
  isKeySet: boolean;
  exerciseType?: string | null;
  loadKg?: number | null;
  round?: number | null;
  station?: number | null;
};

type TrainingSession = {
  id: string;
  weekNumber: number;
  sessionNumber: number;
  scheduledAt: string;
  completed: boolean;
  completedAt: string | null;
  isFinalTest?: boolean;
  sessionKind?: ProgramSessionKind | null;
  /** Круговая: буква дня ротации (A/B/C) и шаблон круга. */
  dayLabel?: string | null;
  circuitTemplateId?: string | null;
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
  programType?: string | null;
  loadKg?: number | null;
  circuitPlanId?: string | null;
  /** Гиревая пройдена: следующий вес гири из пресетов. */
  nextLoadKg?: number | null;
  targetReps: number | null;
  baselineMaxReps: number;
  durationWeeks: number;
  frequencyPerWeek: number;
  status: string;
  sessions: TrainingSession[];
  stats: ProgramStats;
};

type JsonObject = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function fetchJson(url: string) {
  const res = await fetch(url, { credentials: 'include', cache: 'no-store' });
  const text = await res.text();
  let data: JsonObject | null = null;
  if (text) {
    try {
      data = JSON.parse(text) as JsonObject;
    } catch {}
  }
  if (!res.ok) {
    throw new Error(typeof data?.error === 'string' ? data.error : `Ошибка (код ${res.status})`);
  }
  return data;
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

function renderSetPlan(session: TrainingSession, exerciseType: string | undefined, locale: string) {
  const distance = programKind(exerciseType) === 'distance';
  return session.sets
    .slice()
    .sort((a, b) => a.setNumber - b.setNumber)
    .map((set) => (set.isKeySet && !session.isFinalTest && !distance ? 'max' : formatExerciseValue(set.targetReps, exerciseType, true, locale)))
    .join('-');
}

function isCircuitProgram(program: ProgramDetail): boolean {
  return program.programType === 'circuit' || program.exerciseType === 'circuit';
}

/** Круговое занятие: «Дом: всё тело · кругов: 3» и станции первого круга «Приседания 15 · Планка 30 с». */
function circuitSessionLines(session: TrainingSession, locale: 'ru' | 'en'): { title: string; stations: string } {
  const template = getCircuitTemplate(session.circuitTemplateId);
  const rounds = Math.max(1, ...session.sets.map((s) => s.round ?? 1));
  const title = [template?.title[locale], circuitsMessages[locale].program.rounds(rounds)].filter(Boolean).join(' · ');
  const stations = session.sets
    .filter((s) => (s.round ?? 1) === 1)
    .sort((a, b) => (a.station ?? a.setNumber) - (b.station ?? b.setNumber))
    .map((s) => {
      const value = formatExerciseValue(s.targetReps, s.exerciseType ?? undefined, true, locale);
      const load = s.loadKg != null ? ` · ${formatKg(s.loadKg, locale)} ${locale === 'en' ? 'kg' : 'кг'}` : '';
      return `${exerciseLabel(s.exerciseType, locale)} ${value}${load}`;
    })
    .join(' · ');
  return { title, stations };
}

function formatKg(kg: number, locale: string): string {
  const text = String(Math.round(kg * 10) / 10);
  return locale === 'en' ? text : text.replace('.', ',');
}

export default function ProgramDetailPage() {
  const { locale } = useI18n();
  const localeTag = getIntlLocale(locale);
  const tt = useCallback((input: string) => t(locale, input), [locale]);
  const text = programsMessages[locale];
  const circuitText = circuitsMessages[locale].program;
  const programId = useRouteParam('id') || '';

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
      } catch (e: unknown) {
        if (!cancelled) setError(tt(getErrorMessage(e) || 'Не удалось загрузить программу'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [programId, tt]);

  const upcomingSessions = useMemo(
    () => (program?.sessions || []).filter((s) => !s.completed),
    [program],
  );

  const completedSessions = useMemo(
    () => (program?.sessions || []).filter((s) => s.completed),
    [program],
  );

  const sessionsToShow = showCompleted ? completedSessions : upcomingSessions;
  const isCircuit = program ? isCircuitProgram(program) : false;

  // Ротация круговой: «День A — Дом: всё тело» по первому занятию каждого дня.
  const rotation = useMemo(() => {
    if (!program || !isCircuitProgram(program)) return [];
    const byDay = new Map<string, string>();
    for (const s of program.sessions) {
      if (!s.dayLabel || byDay.has(s.dayLabel)) continue;
      const template = getCircuitTemplate(s.circuitTemplateId);
      if (template) byDay.set(s.dayLabel, template.title[locale]);
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [locale, program]);

  return (
    <div className="app-page" style={{ maxWidth: 920 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <BackButton fallbackHref="/program" />
      </div>

      {loading ? <p>{tt('Загрузка…')}</p> : null}
      {error ? <p style={{ color: '#dc2626' }}>{error}</p> : null}

      {program && !loading ? (
        <>
          <section style={card}>
            <div style={{ display: 'grid', gap: 4 }}>
              <div>{tt('Упражнение')}: <b>{programLabel(program, locale)}</b></div>
              {isCircuit ? (
                rotation.length ? (
                  <div data-testid="program-rotation">
                    {circuitText.plan}:{' '}
                    {rotation.map(([day, title], i) => (
                      <span key={day}>
                        {i > 0 ? ' · ' : ''}
                        <b>{circuitText.day(day)}</b> — {title}
                      </span>
                    ))}
                  </div>
                ) : null
              ) : (
                <div>{tt('Базовый тест')}: <b>{formatExerciseValue(program.baselineMaxReps, program.exerciseType, true, locale)}</b> · {tt('Цель')}: <b>{formatExerciseValue(program.targetReps, program.exerciseType, true, locale)}</b></div>
              )}
              <div>{tt('Длительность')}: <b>{program.durationWeeks}</b> {tt('нед')} · {tt('Темп')}: <b>{program.frequencyPerWeek}</b>/{tt('нед')}</div>
              <div>{tt('Прогресс')}: <b>{program.stats.completedSessions}/{program.stats.totalSessions}</b> ({program.stats.completionPercent}%)</div>
            </div>
          </section>

          {program.nextLoadKg != null ? (
            <section style={{ ...card, borderColor: '#93c5fd', background: '#eff6ff' }} data-testid="program-next-load">
              <div style={{ fontWeight: 900 }}>{text.nextLoad.done(programLabel(program, locale))}</div>
              <div style={{ marginTop: 4 }}>{text.nextLoad.offer(formatKg(program.nextLoadKg, locale))}</div>
              <Link
                href={`/program?start=${encodeURIComponent(program.exerciseType)}&loadKg=${program.nextLoadKg}`}
                style={{ ...btnPrimaryLink, marginTop: 8 }}
              >
                {text.nextLoad.start}
              </Link>
            </section>
          ) : null}

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
                      {session.dayLabel ? ` · ${circuitText.day(session.dayLabel)}` : ''}
                      {session.isFinalTest ? ` · ${tt('финальный тест')}` : ''}
                      {session.sessionKind === 'test'
                        ? ` · ${circuitText.testCircuit}`
                        : session.sessionKind
                          ? ` · ${text.sessionKind[session.sessionKind]}`
                          : ''}
                    </div>
                    {isCircuit ? (
                      (() => {
                        const lines = circuitSessionLines(session, locale);
                        return (
                          <>
                            <div style={{ color: '#111827' }}><b>{lines.title}</b></div>
                            <div style={{ color: '#374151', fontSize: 14 }}>{lines.stations}</div>
                          </>
                        );
                      })()
                    ) : (
                      <div style={{ color: '#111827' }}>
                        {tt('План подходов')}: <b>{renderSetPlan(session, program.exerciseType, locale)}</b>
                      </div>
                    )}
                    <div style={{ color: '#111827' }}>
                      {tt('Статус')}: {session.completed ? tt('Выполнено') : tt('Запланировано')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {!session.completed ? (
                      <Link href={programSessionHref(session.id)} style={btnPrimaryLink}>
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
