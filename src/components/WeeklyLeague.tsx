'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useI18n } from '@/i18n/provider';
import { fillLeagueText, leagueMessages, leaguePlaceToken, leaguePointsWord } from '@/i18n/messages/features/league';
import { formatGoalPoints } from '@/lib/daily-goal';
import { ShareButton } from './ShareCardSheet';

type LeagueWeek = 'current' | 'previous';
type LeagueRowDto = { userId: string; username: string; avatarPath: string | null; points: number; place: number; isMe: boolean };
type LeagueResponse = {
  week: LeagueWeek;
  weekStart: string;
  weekEnd: string;
  rows: LeagueRowDto[];
  myPlace: number | null;
  gapToNext: number | null;
  nextPlace: number | null;
};

/** «Лига недели» (F2) on the friends page: me and my friends by points of the week. */
export default function WeeklyLeague({ onAddFriend }: { onAddFriend?: () => void }) {
  const { locale } = useI18n();
  const text = leagueMessages[locale];
  const [week, setWeek] = useState<LeagueWeek>('current');
  const [data, setData] = useState<LeagueResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/league?week=${week}`, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error('load');
        return response.json() as Promise<LeagueResponse>;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setFailed(false);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [week]);

  const numberLocale = locale === 'en' ? 'en-US' : 'ru-RU';
  const formatDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(numberLocale, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const alone = data !== null && data.rows.length < 2;
  const total = data?.rows.length ?? 0;
  const myPoints = data?.rows.find((row) => row.isMe)?.points ?? 0;

  return (
    <section style={card} aria-label={text.title} data-testid="weekly-league">
      <div style={head}>
        <h2 style={title}>{text.title}</h2>
        <div style={switchWrap} role="group" aria-label={text.title}>
          {(['current', 'previous'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setWeek(value)}
              aria-pressed={week === value}
              style={{ ...switchBtn, ...(week === value ? switchBtnActive : null) }}
            >
              {value === 'current' ? text.thisWeek : text.lastWeek}
            </button>
          ))}
        </div>
      </div>

      {failed ? <p style={muted}>{text.loadError}</p> : null}
      {!data && !failed ? <p style={muted}>{text.loading}</p> : null}

      {data ? <p style={muted}>{formatDay(data.weekStart)} – {formatDay(data.weekEnd)}</p> : null}

      {alone ? (
        <div style={empty}>
          <strong>{text.emptyTitle}</strong>
          <span style={muted}>{text.emptyText}</span>
          {onAddFriend ? (
            <button type="button" style={addBtn} onClick={onAddFriend}>
              {text.emptyAction}
            </button>
          ) : null}
        </div>
      ) : null}

      {data && !alone ? (
        <>
          <ol style={list}>
            {data.rows.map((row) => (
              <li key={row.userId} style={{ ...rowStyle, ...(row.isMe ? meRow : null) }} aria-current={row.isMe ? 'true' : undefined}>
                <span style={placeBadge}>{row.place}</span>
                <span style={name}>{row.isMe ? text.me : row.username}</span>
                <span style={pointsText}>
                  {formatGoalPoints(row.points, locale)} {text.pointsShort}
                </span>
              </li>
            ))}
          </ol>
          {data.myPlace !== null ? (
            <div style={summaryRow}>
              <p style={summary}>
                {fillLeagueText(text.yourPlace, { place: leaguePlaceToken(data.myPlace, locale), total })}
                {data.gapToNext !== null && data.nextPlace !== null && week === 'current'
                  ? ` · ${fillLeagueText(text.gapToNext, {
                      place: leaguePlaceToken(data.nextPlace, locale),
                      gap: formatGoalPoints(data.gapToNext, locale),
                      pointsWord: leaguePointsWord(data.gapToNext, locale),
                    })}`
                  : data.myPlace === 1 && week === 'current'
                    ? ` · ${text.leading}`
                    : ''}
              </p>
              <ShareButton input={{ kind: 'league', week: data.week, place: data.myPlace, total, points: myPoints }} />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

const card: CSSProperties = {
  padding: 18,
  border: '1px solid rgba(255, 255, 255, 0.86)',
  borderRadius: 28,
  background: 'linear-gradient(180deg, rgba(255, 255, 255, 0.94) 0%, rgba(248, 250, 252, 0.88) 100%)',
  boxShadow: '0 22px 56px rgba(15, 23, 42, 0.08)',
  marginBottom: 16,
  display: 'grid',
  gap: 10,
};
const head: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
const title: CSSProperties = { margin: 0 };
const switchWrap: CSSProperties = { display: 'inline-flex', gap: 4, padding: 3, borderRadius: 14, background: 'rgba(148, 163, 184, 0.16)' };
const switchBtn: CSSProperties = { padding: '6px 10px', borderRadius: 11, border: 'none', background: 'transparent', fontWeight: 800, fontSize: 13, color: '#475569', cursor: 'pointer' };
const switchBtnActive: CSSProperties = { background: '#fff', color: '#0f172a', boxShadow: '0 2px 8px rgba(15, 23, 42, 0.1)' };
const muted: CSSProperties = { margin: 0, color: '#64748b', fontSize: 14 };
const empty: CSSProperties = { display: 'grid', gap: 8, justifyItems: 'start' };
const addBtn: CSSProperties = { padding: '10px 14px', borderRadius: 14, border: 'none', background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)', color: '#fff', fontWeight: 900, cursor: 'pointer' };
const list: CSSProperties = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 };
const rowStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 14, background: 'rgba(255, 255, 255, 0.7)', minWidth: 0 };
const meRow: CSSProperties = { background: 'rgba(249, 115, 22, 0.14)', border: '1px solid rgba(249, 115, 22, 0.45)', fontWeight: 900 };
const placeBadge: CSSProperties = { width: 26, height: 26, borderRadius: 9, display: 'grid', placeItems: 'center', background: '#0f172a', color: '#fff', fontWeight: 900, fontSize: 13, flex: '0 0 auto' };
const name: CSSProperties = { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const pointsText: CSSProperties = { fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' };
const summary: CSSProperties = { margin: 0, fontWeight: 800, flex: '1 1 200px', minWidth: 0 };
const summaryRow: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' };
