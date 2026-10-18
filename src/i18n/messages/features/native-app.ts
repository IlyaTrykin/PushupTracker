/**
 * Строки приложений для iPhone и Android (Capacitor): оболочка, вход, работа без связи, пуши.
 * В компоненте: `nativeAppMessages[locale].offlineBanner`.
 */
export const nativeAppMessages = {
  ru: {
    offlineBanner: 'Нет связи — показаны сохранённые данные',
    tokenSaveError: 'Не удалось сохранить вход на устройстве. Попробуйте ещё раз.',
    shareDialogTitle: 'Поделиться',
    pushUnavailable: 'Пуш-уведомления станут доступны после публикации',
    pushDenied: 'Уведомления запрещены в настройках телефона. Разрешите их для Pushup Tracker и попробуйте снова.',
  },
  en: {
    offlineBanner: 'No connection — showing saved data',
    tokenSaveError: 'Could not save the sign-in on this device. Please try again.',
    shareDialogTitle: 'Share',
    pushUnavailable: 'Push notifications will be available after publication',
    pushDenied: 'Notifications are turned off in the phone settings. Allow them for Pushup Tracker and try again.',
  },
} as const;
