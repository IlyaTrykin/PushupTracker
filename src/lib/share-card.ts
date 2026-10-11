/**
 * «Поделиться» cards — pure part, safe for client components: what a card says and which link it carries.
 * Drawing the picture is `src/components/share-card-render.ts` (browser canvas).
 */

import { leagueMessages, leaguePlaceToken, leaguePointsWord } from '@/i18n/messages/features/league';
import { shareMessages } from '@/i18n/messages/features/share';
import { ACHIEVEMENT_DEFS, badgeTitle, formatRecordValue, type BadgeCode, type RecordKind } from './achievements';
import { formatGoalPoints } from './daily-goal';
import { exerciseLabel, getExercise } from './exercises';

type Locale = 'ru' | 'en';

export type ShareCardInput =
  | { kind: 'record'; record: RecordKind; exerciseType: string; value: number }
  | { kind: 'badge'; code: BadgeCode }
  | { kind: 'streak'; days: number }
  | { kind: 'league'; week: 'current' | 'previous'; place: number; total: number; points: number };

export type ShareCard = {
  kind: ShareCardInput['kind'];
  emoji: string;
  /** Small label above the headline («Рекорд подхода»). */
  eyebrow: string;
  /** The big line («31», «12 дней»). */
  headline: string;
  /** Under the headline («Отжимания», «дней подряд»). */
  caption: string;
  /** Hex colour of the glow and the eyebrow pill. */
  accent: string;
  /** Message text for the share sheet; the link goes separately. */
  text: string;
  /** Short name for the image file and screen readers. */
  label: string;
};

/** Smallest streak worth a share button. */
export const MIN_SHARE_STREAK = 3;

const BRAND_ACCENT = '#ea580c';
const BADGE_ACCENT = '#d97706';
const LEAGUE_ACCENT = '#4f46e5';
const BADGE_ICONS = new Map(ACHIEVEMENT_DEFS.map((def) => [def.code, def.icon]));

export function fillShareText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

/** «день / дня / дней подряд», «day / days in a row». */
export function streakDaysWord(days: number, locale: Locale): string {
  const [one, few, many] = shareMessages[locale].streakDays;
  if (locale === 'en') return days === 1 ? one : few;
  const lastTwo = days % 100;
  const last = days % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

function leagueEmoji(place: number): string {
  return place === 1 ? '🥇' : place === 2 ? '🥈' : place === 3 ? '🥉' : '🏁';
}

export function buildShareCard(input: ShareCardInput, locale: Locale): ShareCard {
  const text = shareMessages[locale];
  switch (input.kind) {
    case 'record': {
      const title = input.record === 'best_set' ? text.bestSet : text.bestDay;
      const exercise = exerciseLabel(input.exerciseType, locale);
      const value = formatRecordValue(input.value, input.exerciseType, locale);
      return {
        kind: 'record',
        emoji: '🏆',
        eyebrow: title,
        headline: value,
        caption: exercise,
        accent: getExercise(input.exerciseType).colors.accent,
        text: fillShareText(text.textRecord, { title, exercise, value }),
        label: `${title}: ${exercise} — ${value}`,
      };
    }
    case 'badge': {
      const title = badgeTitle(input.code, locale);
      const description = ACHIEVEMENT_DEFS.find((def) => def.code === input.code)?.description[locale] ?? '';
      return {
        kind: 'badge',
        emoji: BADGE_ICONS.get(input.code) ?? '🏅',
        eyebrow: text.badge,
        headline: title,
        caption: description,
        accent: BADGE_ACCENT,
        text: fillShareText(text.textBadge, { title }),
        label: `${text.badge}: ${title}`,
      };
    }
    case 'streak': {
      const days = Math.max(0, Math.floor(input.days));
      const daysWord = streakDaysWord(days, locale);
      return {
        kind: 'streak',
        emoji: '🔥',
        eyebrow: text.streak,
        headline: String(days),
        caption: daysWord,
        accent: BRAND_ACCENT,
        text: fillShareText(text.textStreak, { days, daysWord }),
        label: `${text.streak}: ${days} ${daysWord}`,
      };
    }
    case 'league': {
      const place = leaguePlaceToken(input.place, locale);
      const headline = fillShareText(text.leaguePlace, { place });
      const caption = fillShareText(text.leagueOf, {
        total: input.total,
        points: formatGoalPoints(input.points, locale),
        pointsWord: leaguePointsWord(input.points, locale),
      });
      const eyebrow = input.week === 'previous' ? text.leaguePrevious : text.league;
      return {
        kind: 'league',
        emoji: leagueEmoji(input.place),
        eyebrow,
        headline,
        caption,
        accent: LEAGUE_ACCENT,
        text: fillShareText(text.textLeague, { place, total: input.total }),
        label: `${leagueMessages[locale].title}: ${headline} ${caption}`,
      };
    }
  }
}

/**
 * The link a card carries: the sharer's invite link tagged with where it came from, so
 * `/admin/growth` can tell card shares from plain invites (the signup still counts as `invite`).
 */
export function shareCardUrl(inviteUrl: string, kind: ShareCardInput['kind']): string {
  try {
    const url = new URL(inviteUrl);
    url.searchParams.set('utm_source', 'share');
    url.searchParams.set('utm_medium', 'card');
    url.searchParams.set('utm_campaign', kind);
    return url.toString();
  } catch {
    return inviteUrl;
  }
}

/** «host/invite/code» for the picture: no scheme, no query. */
export function displayLink(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
  } catch {
    return url;
  }
}

/** `pushup-tracker-record.png` — ASCII only, so every share target accepts it. */
export function shareCardFileName(kind: ShareCardInput['kind']): string {
  return `pushup-tracker-${kind}.png`;
}
