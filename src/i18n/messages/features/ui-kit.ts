/**
 * Shared UI kit (`src/components/ui/`): sheet, «i» button, back button, levels inside a page.
 * Used as `uiKitMessages[locale]`; `{title}` is replaced in place.
 */
export const uiKitMessages = {
  ru: {
    close: 'Закрыть',
    back: 'Назад',
    info: 'Пояснение',
    infoAbout: 'Пояснение: {title}',
  },
  en: {
    close: 'Close',
    back: 'Back',
    info: 'More info',
    infoAbout: 'About: {title}',
  },
} as const;
