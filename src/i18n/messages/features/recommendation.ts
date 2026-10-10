/** «Рекомендация на сегодня» (F12) on the dashboard. Used as `recommendationMessages[locale]`. */
export const recommendationMessages = {
  ru: {
    title: 'Рекомендация на сегодня',
    deloadHint: 'Вчера был тяжёлый день — сегодня полегче',
    growHint: 'Чуть больше лучшего дня за 2 недели',
    empty: 'Сделай пару подходов, и я подскажу план',
    seconds: 'сек',
  },
  en: {
    title: 'Today\'s recommendation',
    deloadHint: 'Yesterday was a heavy day — go lighter today',
    growHint: 'A bit more than your best day in 2 weeks',
    empty: 'Do a couple of sets, and I\'ll suggest a plan',
    seconds: 's',
  },
} as const;
