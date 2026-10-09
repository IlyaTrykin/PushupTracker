/**
 * Format of a feature messages file (copy to `<slug>.ts`, rename the export).
 * Both locales must have the same keys; in a component: `exampleMessages[locale].title`.
 */
export const exampleMessages = {
  ru: {
    title: 'Пример',
    progress: 'Сегодня {done} из {goal}',
  },
  en: {
    title: 'Example',
    progress: 'Today {done} of {goal}',
  },
} as const;
