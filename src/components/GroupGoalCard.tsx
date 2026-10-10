'use client';

import { useCallback, useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { useAuth } from '@/auth/provider';
import { useI18n } from '@/i18n/provider';
import { fillGroupGoalTemplate, groupGoalErrorText, groupGoalMessages } from '@/i18n/messages/features/group-goal';
import { addDays, diffDays } from '@/lib/calendar-day';
import { localTodayKey } from '@/lib/day-stats';
import { EXERCISE_ORDER, exerciseLabel } from '@/lib/exercises';
import type { GroupGoalDto } from '@/lib/group-goal';

type GoalsResponse = { active: GroupGoalDto | null; past: GroupGoalDto[] };

export default function GroupGoalCard({ groupId, canManage }: { groupId: string; canManage: boolean }) {
  const { user } = useAuth();
  const { locale } = useI18n();
  const text = groupGoalMessages[locale];
  const numberLocale = locale === 'en' ? 'en-US' : 'ru-RU';
  const formatNumber = (value: number) => value.toLocaleString(numberLocale, { maximumFractionDigits: 1 });
  const formatDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(numberLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' });

  const [data, setData] = useState<GoalsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [points, setPoints] = useState('10000');
  const [exercise, setExercise] = useState('all');
  const [from, setFrom] = useState(() => localTodayKey(user?.timeZone));
  const [to, setTo] = useState(() => addDays(localTodayKey(user?.timeZone), 30));

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/groups/${groupId}/goals`, { cache: 'no-store' });
      if (!response.ok) throw new Error('load');
      setData((await response.json()) as GoalsResponse);
      setError(null);
    } catch {
      setError(text.errors.load);
    }
  }, [groupId, text.errors.load]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch(`/api/groups/${groupId}/goals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, targetPoints: Number(points), exerciseType: exercise, startDate: from, endDate: to }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        setError(groupGoalErrorText(locale, body?.code));
        return;
      }
      setTitle('');
      setInfo(text.created);
      await load();
    } catch {
      setError(text.errors.save);
    } finally {
      setSaving(false);
    }
  }

  async function stop(goal: GroupGoalDto) {
    if (!window.confirm(text.stopConfirm)) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    try {
      const response = await fetch(`/api/groups/${groupId}/goals/${goal.id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { code?: string } | null;
        setError(groupGoalErrorText(locale, body?.code));
        return;
      }
      setInfo(text.stopped);
      await load();
    } catch {
      setError(text.errors.save);
    } finally {
      setSaving(false);
    }
  }

  function exerciseText(goal: GroupGoalDto): string {
    return goal.exerciseType ? exerciseLabel(goal.exerciseType, locale) : text.anyExercise;
  }

  function timeText(goal: GroupGoalDto): string {
    const today = localTodayKey(user?.timeZone);
    if (goal.startDay > today) return fillGroupGoalTemplate(text.upcoming, { date: formatDay(goal.startDay) });
    const left = diffDays(goal.endDay, today) + 1;
    return left <= 1 ? text.lastDay : fillGroupGoalTemplate(text.daysLeft, { days: left });
  }

  const active = data?.active ?? null;

  return (
    <section style={card} aria-label={text.title}>
      <h2 style={heading}>{text.title}</h2>
      {error ? <p style={errorBanner}>{error}</p> : null}
      {info ? <p style={infoBanner}>{info}</p> : null}
      {!data && !error ? <p style={muted}>{text.loading}</p> : null}

      {data && active ? (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 17, overflowWrap: 'anywhere' }}>{active.title}</strong>
            <span style={muted}>{timeText(active)}</span>
          </div>
          <div style={muted}>
            {exerciseText(active)} · {fillGroupGoalTemplate(text.period, { from: formatDay(active.startDay), to: formatDay(active.endDay) })}
          </div>
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={active.percent}
            aria-label={text.progress}
            style={track}
          >
            <div style={{ ...fill, width: `${active.percent}%` }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <span>{fillGroupGoalTemplate(text.pointsOf, { done: formatNumber(active.totalPoints), target: formatNumber(active.targetPoints) })}</span>
            <strong>{fillGroupGoalTemplate(text.percent, { percent: active.percent })}</strong>
          </div>
          {active.reached ? <div style={reachedBanner}>{text.reachedBanner}</div> : null}

          <h3 style={subHeading}>{text.contributions}</h3>
          {active.contributions.length === 0 ? <p style={muted}>{text.noContributions}</p> : null}
          <div style={{ display: 'grid', gap: 6 }}>
            {active.contributions.map((item) => (
              <div key={item.userId} style={contributionRow}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ overflowWrap: 'anywhere' }}>{item.username}</span>
                  <strong>{formatNumber(item.points)}</strong>
                </div>
                <div style={miniTrack}>
                  <div style={{ ...miniFill, width: `${Math.max(2, Math.round((item.points / active.contributions[0].points) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>

          {canManage ? (
            <button type="button" style={dangerButton} disabled={saving} onClick={() => void stop(active)}>
              {text.stop}
            </button>
          ) : null}
        </div>
      ) : null}

      {data && !active ? <p style={muted}>{canManage ? text.emptyOwner : text.empty}</p> : null}

      {data && !active && canManage ? (
        <form onSubmit={create} style={{ display: 'grid', gap: 10 }}>
          <h3 style={subHeading}>{text.createTitle}</h3>
          <label style={label}>
            {text.nameLabel}
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={text.namePlaceholder} style={field} required />
          </label>
          <label style={label}>
            {text.pointsLabel}
            <input type="number" inputMode="numeric" min={100} max={10000000} step={1} value={points} onChange={(e) => setPoints(e.target.value)} style={field} required />
          </label>
          <label style={label}>
            {text.exerciseLabel}
            <select value={exercise} onChange={(e) => setExercise(e.target.value)} style={field}>
              <option value="all">{text.anyExercise}</option>
              {EXERCISE_ORDER.map((id) => (
                <option key={id} value={id}>{exerciseLabel(id, locale)}</option>
              ))}
            </select>
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10 }}>
            <label style={label}>
              {text.fromLabel}
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={field} required />
            </label>
            <label style={label}>
              {text.toLabel}
              <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} style={field} required />
            </label>
          </div>
          <button type="submit" style={primaryButton} disabled={saving || !title.trim()}>{text.create}</button>
        </form>
      ) : null}

      {data && data.past.length > 0 ? (
        <div style={{ display: 'grid', gap: 6 }}>
          <h3 style={subHeading}>{text.past}</h3>
          {data.past.map((goal) => (
            <div key={goal.id} style={contributionRow}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ overflowWrap: 'anywhere' }}>{goal.title}</span>
                <strong>{goal.reached ? text.pastReached : goal.stopped ? text.pastStopped : text.pastMissed}</strong>
              </div>
              <span style={muted}>
                {formatNumber(goal.totalPoints)} / {formatNumber(goal.targetPoints)} · {fillGroupGoalTemplate(text.period, { from: formatDay(goal.startDay), to: formatDay(goal.endDay) })}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

const card: CSSProperties = {
  display: 'grid',
  gap: 12,
  padding: 16,
  borderRadius: 18,
  background: 'rgba(255,255,255,0.92)',
  border: '1px solid rgba(148, 163, 184, 0.28)',
  minWidth: 0,
};
const heading: CSSProperties = { margin: 0, fontSize: 18 };
const subHeading: CSSProperties = { margin: '4px 0 0', fontSize: 15 };
const muted: CSSProperties = { margin: 0, color: '#64748b', fontSize: 14 };
const track: CSSProperties = { height: 14, borderRadius: 999, background: 'rgba(148, 163, 184, 0.28)', overflow: 'hidden' };
const fill: CSSProperties = { height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #0f766e, #14b8a6)' };
const miniTrack: CSSProperties = { height: 6, borderRadius: 999, background: 'rgba(148, 163, 184, 0.22)', overflow: 'hidden' };
const miniFill: CSSProperties = { height: '100%', borderRadius: 999, background: '#0f766e' };
const contributionRow: CSSProperties = { display: 'grid', gap: 4, padding: '8px 10px', borderRadius: 12, background: 'rgba(248, 250, 252, 0.9)' };
const label: CSSProperties = { display: 'grid', gap: 4, fontSize: 14, color: '#334155' };
const field: CSSProperties = { padding: '10px 12px', borderRadius: 12, border: '1px solid rgba(148, 163, 184, 0.5)', fontSize: 16, minWidth: 0, width: '100%', boxSizing: 'border-box' };
const primaryButton: CSSProperties = { padding: '12px 14px', borderRadius: 12, border: 'none', background: '#0f766e', color: '#fff', fontSize: 16, cursor: 'pointer' };
const dangerButton: CSSProperties = { padding: '10px 14px', borderRadius: 12, border: '1px solid #fca5a5', background: '#fff', color: '#b91c1c', fontSize: 15, cursor: 'pointer' };
const errorBanner: CSSProperties = { margin: 0, padding: '8px 12px', borderRadius: 12, background: '#fef2f2', color: '#b91c1c', fontSize: 14 };
const infoBanner: CSSProperties = { margin: 0, padding: '8px 12px', borderRadius: 12, background: '#f0fdfa', color: '#0f766e', fontSize: 14 };
const reachedBanner: CSSProperties = { padding: '8px 12px', borderRadius: 12, background: '#ecfdf5', color: '#047857', fontWeight: 600 };
