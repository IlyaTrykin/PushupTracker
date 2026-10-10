/**
 * «всего: 12,5 балла» under a day's details (dashboard, a friend's day, a group member's day).
 * One function for all three screens; the plural word comes from the league's `leaguePointsWord`.
 */
import { leaguePointsWord } from './league';

export const pointsMessages = {
  ru: { dayTotal: 'всего: {points} {pointsWord}' },
  en: { dayTotal: 'total: {points} {pointsWord}' },
} as const;

export function formatDayPointsTotal(points: number, locale: 'ru' | 'en'): string {
  const value = Math.round(points * 10) / 10;
  const number = value.toLocaleString(locale === 'en' ? 'en-US' : 'ru-RU', { maximumFractionDigits: 1 });
  return pointsMessages[locale].dayTotal
    .replace('{points}', number)
    .replace('{pointsWord}', leaguePointsWord(value, locale));
}
