/** Program session runner: the «finish» card. Used as `programSessionMessages[locale]`. */
export const programSessionMessages = {
  ru: {
    finish: {
      hint: 'Все подходы записаны — осталось завершить тренировку.',
      button: 'Завершить тренировку',
      finishing: 'Завершаем…',
      failed: 'Не удалось завершить тренировку. Попробуйте ещё раз.',
    },
  },
  en: {
    finish: {
      hint: 'All sets are recorded — finish the workout to save it.',
      button: 'Finish workout',
      finishing: 'Finishing…',
      failed: "Couldn't finish the workout. Please try again.",
    },
  },
} as const;
