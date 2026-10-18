/**
 * Counting reps with the phone's camera / proximity sensor (app only): buttons under the reps
 * field of the workout form and what the form says after the native screen closes.
 */
export const repCounterMessages = {
  ru: {
    cameraButton: '📷 Считать камерой',
    proximityButton: '✋ Считать касанием',
    counted: 'Посчитано: {reps} за {duration}. Проверьте и нажмите «Добавить».',
    empty: 'Повторения не засчитаны — число в форме не изменилось.',
    permissionDenied: 'Нет доступа к камере — счёт камерой не работает. Разрешите доступ в настройках, а пока введите число вручную.',
    openSettings: 'Открыть настройки',
    noCamera: 'На этом устройстве нет камеры. Введите число вручную.',
    noSensor: 'На этом устройстве нет датчика приближения.',
    unsupported: 'Счёт повторений недоступен на этой версии системы.',
    failed: 'Не удалось запустить счёт: {message}',
    durationNote: 'Время подхода: {duration}',
  },
  en: {
    cameraButton: '📷 Count with camera',
    proximityButton: '✋ Count by touch',
    counted: 'Counted: {reps} in {duration}. Check it and tap “Add”.',
    empty: 'No reps counted — the number in the form is unchanged.',
    permissionDenied: 'No camera access, so the camera can’t count. Allow it in Settings; meanwhile enter the number yourself.',
    openSettings: 'Open Settings',
    noCamera: 'This device has no camera. Enter the number yourself.',
    noSensor: 'This device has no proximity sensor.',
    unsupported: 'Rep counting isn’t available on this system version.',
    failed: 'Couldn’t start counting: {message}',
    durationNote: 'Set time: {duration}',
  },
} as const;
