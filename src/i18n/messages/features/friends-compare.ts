/**
 * Hiding a friend from the comparison table on /friends (the friendship, league and feed stay).
 * Used as `friendsCompareMessages[locale]`; `{x}` placeholders are replaced in place.
 */
export const friendsCompareMessages = {
  ru: {
    hide: 'Скрыть',
    hideAria: 'Скрыть {name} из таблицы',
    hiddenSummary: 'Скрыто из таблицы: {n}',
    show: 'Вернуть',
    showAria: 'Вернуть {name} в таблицу',
    hint: 'Скрытые остаются в друзьях: лига недели, лента и уведомления не меняются.',
    error: 'Не удалось изменить таблицу, попробуй ещё раз',
  },
  en: {
    hide: 'Hide',
    hideAria: 'Hide {name} from the table',
    hiddenSummary: 'Hidden from the table: {n}',
    show: 'Show',
    showAria: 'Show {name} in the table',
    hint: 'Hidden people stay your friends: the weekly league, feed and notifications do not change.',
    error: 'Could not update the table, try again',
  },
} as const;
