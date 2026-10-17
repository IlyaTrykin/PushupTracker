/**
 * Строки записи тренировок в Apple Health / Health Connect (блок «Здоровье» в профиле приложения).
 * В компоненте: `nativeHealthMessages[locale].sectionTitle`.
 */
export const nativeHealthMessages = {
  ru: {
    sectionTitle: 'Здоровье',
    toggleAppleHealth: 'Записывать тренировки в Apple Health',
    toggleHealthConnect: 'Записывать тренировки в Health Connect',
    summaryAppleHealth: 'Каждая тренировка попадёт в приложение «Здоровье»: тип, время и длительность, для бега, велосипеда и гребли — дистанция. Удалённая тренировка удалится и оттуда.',
    summaryHealthConnect: 'Каждая тренировка попадёт в Health Connect, а через него — в Samsung Health, Google Fit и другие приложения. Удалённая тренировка удалится и оттуда.',
    progress: 'Переношу в Health: {done} из {total}',
    finished: 'Тренировки перенесены в Health',
    upToDate: 'Тренировки в Health актуальны',
    failed: 'Не удалось записать тренировки в Health. Попробую снова при следующем открытии приложения.',
    notInstalled: 'Health Connect не установлен. Установите его из Google Play и включите запись снова.',
    updateRequired: 'Нужна новая версия Health Connect. Обновите его в Google Play и включите запись снова.',
    notSupported: 'На этом устройстве запись в Health недоступна.',
    denied: 'Нет разрешения на запись тренировок. Разрешите его в настройках и включите запись снова.',
    installHealthConnect: 'Открыть Google Play',
    openSettings: 'Открыть настройки',
  },
  en: {
    sectionTitle: 'Health',
    toggleAppleHealth: 'Save workouts to Apple Health',
    toggleHealthConnect: 'Save workouts to Health Connect',
    summaryAppleHealth: 'Every workout goes to the Health app: type, time and duration, plus distance for running, cycling and rowing. A deleted workout is deleted there too.',
    summaryHealthConnect: 'Every workout goes to Health Connect and through it to Samsung Health, Google Fit and other apps. A deleted workout is deleted there too.',
    progress: 'Copying to Health: {done} of {total}',
    finished: 'Workouts copied to Health',
    upToDate: 'Workouts in Health are up to date',
    failed: 'Could not save workouts to Health. I will try again the next time the app opens.',
    notInstalled: 'Health Connect is not installed. Install it from Google Play and switch this on again.',
    updateRequired: 'Health Connect needs an update. Update it in Google Play and switch this on again.',
    notSupported: 'Saving to Health is not available on this device.',
    denied: 'No permission to save workouts. Allow it in settings and switch this on again.',
    installHealthConnect: 'Open Google Play',
    openSettings: 'Open settings',
  },
} as const;
