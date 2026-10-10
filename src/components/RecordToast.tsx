'use client';

import { useEffect, type CSSProperties } from 'react';
import { achievementsMessages, fillAchievementText } from '@/i18n/messages/features/achievements';
import {
  ACHIEVEMENT_DEFS,
  badgeTitle,
  formatRecordValue,
  type AchievementDto,
  type RecordHit,
} from '@/lib/achievements';
import { exerciseLabel } from '@/lib/exercises';

type Locale = 'ru' | 'en';

export type Celebration = { records: RecordHit[]; achievements: AchievementDto[] };

const SHOW_MS = 5000;
const ICON_BY_CODE = new Map(ACHIEVEMENT_DEFS.map((def) => [def.code, def.icon]));

/** Reads `records`/`achievements` of a `POST /api/workouts` response; `null` when there is nothing to celebrate. */
export function readCelebration(data: unknown): Celebration | null {
  if (!data || typeof data !== 'object') return null;
  const { records, achievements } = data as { records?: unknown; achievements?: unknown };
  const out: Celebration = {
    records: Array.isArray(records) ? (records as RecordHit[]).filter((r) => r && (r.kind === 'best_set' || r.kind === 'best_day')) : [],
    achievements: Array.isArray(achievements) ? (achievements as AchievementDto[]).filter((a) => a && ICON_BY_CODE.has(a.code)) : [],
  };
  return out.records.length || out.achievements.length ? out : null;
}

/** «Новый рекорд подхода!» / «Рекорд дня!» / «Новый значок: …» after saving a set; closes itself. */
export default function RecordToast({ celebration, locale, onClose }: { celebration: Celebration; locale: Locale; onClose: () => void }) {
  const text = achievementsMessages[locale];

  useEffect(() => {
    const timer = window.setTimeout(onClose, SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [celebration, onClose]);

  return (
    <div role="status" aria-live="polite" style={wrap} onClick={onClose}>
      {celebration.records.map((hit) => (
        <div key={`${hit.kind}-${hit.exerciseType}`} style={row}>
          <span style={icon} aria-hidden="true">🏆</span>
          <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <div style={titleStyle}>{hit.kind === 'best_set' ? text.toastBestSet : text.toastBestDay}</div>
            <div style={sub}>
              {exerciseLabel(hit.exerciseType, locale)}: {formatRecordValue(hit.value, hit.exerciseType, locale)}
              {hit.previous != null
                ? ` (${fillAchievementText(text.toastPrevious, { previous: formatRecordValue(hit.previous, hit.exerciseType, locale) })})`
                : ''}
            </div>
          </div>
        </div>
      ))}
      {celebration.achievements.map((badge) => (
        <div key={badge.id} style={row}>
          <span style={icon} aria-hidden="true">{ICON_BY_CODE.get(badge.code)}</span>
          <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
            <div style={titleStyle}>{fillAchievementText(text.toastBadge, { title: badgeTitle(badge.code, locale) })}</div>
            <div style={sub}>{text.badges[badge.code].description}</div>
          </div>
        </div>
      ))}
      <button type="button" aria-label={text.close} style={closeBtn} onClick={onClose}>
        ×
      </button>
    </div>
  );
}

const wrap: CSSProperties = {
  position: 'fixed',
  top: 76,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 10000,
  width: 'min(360px, calc(100vw - 32px))',
  boxSizing: 'border-box',
  display: 'grid',
  gap: 10,
  padding: '14px 40px 14px 14px',
  borderRadius: 20,
  border: '1px solid #fcd34d',
  background: 'linear-gradient(135deg, #fffbeb 0%, #ffffff 80%)',
  boxShadow: '0 24px 56px rgba(15, 23, 42, 0.18)',
  cursor: 'pointer',
};

const row: CSSProperties = { display: 'flex', gap: 10, alignItems: 'center' };
const icon: CSSProperties = { fontSize: 28, lineHeight: 1, flex: '0 0 auto' };
const titleStyle: CSSProperties = { fontSize: 16, fontWeight: 900, color: '#0f172a' };
const sub: CSSProperties = { fontSize: 13, color: '#475569', overflowWrap: 'anywhere' };
const closeBtn: CSSProperties = {
  position: 'absolute',
  top: 6,
  right: 8,
  border: 'none',
  background: 'transparent',
  fontSize: 22,
  lineHeight: 1,
  color: '#64748b',
  cursor: 'pointer',
  padding: 4,
};
