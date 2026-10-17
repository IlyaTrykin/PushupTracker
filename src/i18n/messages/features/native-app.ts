/**
 * Строки приложений для iPhone и Android (Capacitor): оболочка, вход, работа без связи.
 * В компоненте: `nativeAppMessages[locale].offlineBanner`.
 */
export const nativeAppMessages = {
  ru: {
    offlineBanner: 'Нет связи — показаны сохранённые данные',
    tokenSaveError: 'Не удалось сохранить вход на устройстве. Попробуйте ещё раз.',
    shareDialogTitle: 'Поделиться',
  },
  en: {
    offlineBanner: 'No connection — showing saved data',
    tokenSaveError: 'Could not save the sign-in on this device. Please try again.',
    shareDialogTitle: 'Share',
  },
} as const;
