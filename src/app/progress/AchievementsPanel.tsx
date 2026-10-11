'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { achievementsMessages, fillAchievementText } from '@/i18n/messages/features/achievements';
import { getIntlLocale } from '@/i18n/translate';
import { ACHIEVEMENT_DEFS, formatRecordValue, type BadgeCode, type PersonalBest } from '@/lib/achievements';
import { exerciseIcon, exerciseLabel } from '@/lib/exercises';
import { ShareButton } from '@/components/ShareCardSheet';

type Locale = 'ru' | 'en';
type AchievementsPayload = {
  badges: Array<{ code: BadgeCode; achievedAt: string | null }>;
  records: PersonalBest[];
};

function formatDay(value: string, locale: Locale): string {
  // Day keys are calendar days ('YYYY-MM-DD'); badge dates are instants.
  const date = value.length === 10 ? new Date(`${value}T12:00:00Z`) : new Date(value);
  return date.toLocaleDateString(getIntlLocale(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(value.length === 10 ? { timeZone: 'UTC' } : {}),
  });
}

/** «Достижения» of the progress page: badges (earned with a date, the rest grey) and personal bests. */
export default function AchievementsPanel({ locale, userId }: { locale: Locale; userId?: string }) {
  const text = achievementsMessages[locale];
  const [data, setData] = useState<AchievementsPayload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const url = userId ? `/api/achievements?userId=${encodeURIComponent(userId)}` : '/api/achievements';
    fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((payload: AchievementsPayload) => {
        if (!cancelled) setData(payload);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!data) return <div style={muted}>{failed ? text.loadFailed : text.loading}</div>;

  const earnedAt = new Map(data.badges.map((badge) => [badge.code, badge.achievedAt]));
  // Only your own achievements get «Поделиться»: the card carries your invite link.
  const own = !userId;

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={badgeGrid}>
        {ACHIEVEMENT_DEFS.map((def) => {
          const at = earnedAt.get(def.code) ?? null;
          return (
            <div key={def.code} style={at ? badgeCard : { ...badgeCard, ...badgeLocked }} data-earned={at ? 'true' : 'false'}>
              <div style={{ ...badgeIcon, ...(at ? {} : { filter: 'grayscale(1)', opacity: 0.45 }) }} aria-hidden="true">{def.icon}</div>
              <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                <div style={badgeTitle}>{def.title[locale]}</div>
                <div style={badgeDesc}>{def.description[locale]}</div>
                <div style={at ? badgeDate : { ...badgeDate, color: '#94a3b8' }}>
                  {at ? fillAchievementText(text.earnedOn, { date: formatDay(at, locale) }) : text.notEarned}
                </div>
                {at && own ? (
                  <div style={{ marginTop: 4 }}>
                    <ShareButton input={{ kind: 'badge', code: def.code }} />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 900, color: '#0f172a' }}>{text.recordsTitle}</div>
        {data.records.length === 0 ? <div style={muted}>{text.recordsEmpty}</div> : null}
        {data.records.map((best) => (
          <div key={best.exerciseType} style={recordRow}>
            <div style={recordHead}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={exerciseIcon(best.exerciseType)} alt="" width={20} height={20} style={{ flex: '0 0 auto' }} />
              <div style={{ fontWeight: 800, color: '#0f172a', minWidth: 0 }}>{exerciseLabel(best.exerciseType, locale)}</div>
            </div>
            <div style={recordCell}>
              <span style={recordLabel}>{text.bestSet}</span>
              <span style={recordValueRow}>
                <span style={recordValue}>{formatRecordValue(best.bestSet.value, best.exerciseType, locale)}</span>
                {own ? <ShareButton input={{ kind: 'record', record: 'best_set', exerciseType: best.exerciseType, value: best.bestSet.value }} iconOnly /> : null}
              </span>
              <span style={recordDate}>{formatDay(best.bestSet.day, locale)}</span>
            </div>
            <div style={recordCell}>
              <span style={recordLabel}>{text.bestDay}</span>
              <span style={recordValueRow}>
                <span style={recordValue}>{formatRecordValue(best.bestDay.value, best.exerciseType, locale)}</span>
                {own ? <ShareButton input={{ kind: 'record', record: 'best_day', exerciseType: best.exerciseType, value: best.bestDay.value }} iconOnly /> : null}
              </span>
              <span style={recordDate}>{formatDay(best.bestDay.day, locale)}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const muted: CSSProperties = { fontSize: 13, color: '#64748b' };

const badgeGrid: CSSProperties = {
  display: 'grid',
  gap: 10,
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
};

const badgeCard: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'flex-start',
  padding: 12,
  borderRadius: 16,
  border: '1px solid #fcd34d',
  background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 85%)',
  minWidth: 0,
};

const badgeLocked: CSSProperties = {
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  color: '#94a3b8',
};

const badgeIcon: CSSProperties = { fontSize: 26, lineHeight: 1, flex: '0 0 auto' };
const badgeTitle: CSSProperties = { fontSize: 14, fontWeight: 900, color: 'inherit' };
const badgeDesc: CSSProperties = { fontSize: 12, color: '#64748b' };
const badgeDate: CSSProperties = { fontSize: 11, fontWeight: 700, color: '#b45309' };

const recordRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
  gap: '6px 10px',
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 14,
  border: '1px solid #e2e8f0',
  background: '#ffffff',
};

const recordHead: CSSProperties = { gridColumn: '1 / -1', display: 'flex', gap: 8, alignItems: 'center' };
const recordCell: CSSProperties = { display: 'grid', justifyItems: 'start', gap: 1 };
const recordLabel: CSSProperties = { fontSize: 10, fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.3 };
const recordValueRow: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 };
const recordValue: CSSProperties = { fontSize: 15, fontWeight: 900, color: '#0f172a', whiteSpace: 'nowrap' };
const recordDate: CSSProperties = { fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' };
