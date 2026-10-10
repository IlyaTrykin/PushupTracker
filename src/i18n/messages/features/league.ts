/**
 * Weekly league among friends (F2) and the weekly summary (F7): the friends-page block
 * and the texts of `weekly_league` / `weekly_summary` notifications. Used as `leagueMessages[locale]`.
 * `{x}` placeholders are filled by `fillLeagueText`.
 */
export const leagueMessages = {
  ru: {
    title: 'Лига недели',
    hint: 'Баллы с понедельника по воскресенье: ты и твои друзья.',
    thisWeek: 'Эта неделя',
    lastWeek: 'Прошлая',
    me: 'Ты',
    pointsShort: 'б.',
    /** Plural forms of «балл»: 1, 2–4, 5+ (fractions use the second). */
    pointsWords: ['балл', 'балла', 'баллов'],
    yourPlace: 'Ты на {place}-м месте из {total}',
    leading: 'Ты впереди всех',
    gapToNext: 'До {place}-го места — {gap} {pointsWord}',
    loading: 'Загружаю лигу…',
    loadError: 'Не удалось загрузить лигу',
    emptyTitle: 'Лига оживает, когда рядом друзья',
    emptyText: 'Добавь друга — и вы начнёте соревноваться по баллам за неделю.',
    emptyAction: 'Добавить друга',
    league: {
      title: 'Лига недели',
      body: 'Ты {place}-й из {total}: {points} {pointsWord} за неделю.',
      bodyWinner: 'Ты {place}-й из {total}: {points} {pointsWord} за неделю — победа в лиге!',
    },
    summary: {
      title: 'Итоги недели',
      total: 'За неделю: {points} {pointsWord}',
      changeUp: ', на {percent}% больше, чем на прошлой',
      changeDown: ', на {percent}% меньше, чем на прошлой',
      changeSame: ', как и на прошлой неделе',
      noPrevious: ', на прошлой неделе тренировок не было',
      bestDay: 'Лучший день — {day}, {points} {pointsWord}.',
      place: 'В лиге друзей — {place}-е место из {total}.',
    },
  },
  en: {
    title: 'Weekly league',
    hint: 'Points from Monday to Sunday: you and your friends.',
    thisWeek: 'This week',
    lastWeek: 'Last week',
    me: 'You',
    pointsShort: 'pts',
    pointsWords: ['point', 'points', 'points'],
    yourPlace: 'You are {place} of {total}',
    leading: 'You are in the lead',
    gapToNext: '{gap} {pointsWord} to {place} place',
    loading: 'Loading the league…',
    loadError: 'Could not load the league',
    emptyTitle: 'The league comes alive with friends',
    emptyText: 'Add a friend and you will compete on weekly points.',
    emptyAction: 'Add a friend',
    league: {
      title: 'Weekly league',
      body: 'You finished {place} of {total}: {points} {pointsWord} this week.',
      bodyWinner: 'You finished {place} of {total}: {points} {pointsWord} this week. You won the league!',
    },
    summary: {
      title: 'Your week',
      total: 'This week: {points} {pointsWord}',
      changeUp: ', {percent}% more than last week',
      changeDown: ', {percent}% less than last week',
      changeSame: ', same as last week',
      noPrevious: ', no workouts last week',
      bestDay: 'Best day: {day}, {points} {pointsWord}.',
      place: 'In the friends league: {place} of {total}.',
    },
  },
} as const;

export function fillLeagueText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));
}

function englishOrdinal(n: number): string {
  const lastTwo = n % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

/** The place as it enters a template: ru «2» (the suffix is in the template), en «2nd». */
export function leaguePlaceToken(place: number, locale: 'ru' | 'en'): string {
  return locale === 'en' ? englishOrdinal(place) : String(place);
}

/** «балл / балла / баллов», «point / points»; fractions take the second form. */
export function leaguePointsWord(points: number, locale: 'ru' | 'en'): string {
  const [one, few, many] = leagueMessages[locale].pointsWords;
  if (locale === 'en') return points === 1 ? one : few;
  if (!Number.isInteger(points)) return few;
  const lastTwo = points % 100;
  const last = points % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
