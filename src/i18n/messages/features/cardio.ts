/** Cardio (run, cycling, rowing): entry of distance and optional time. Used as `cardioMessages[locale]`. */
export const cardioMessages = {
  ru: {
    distanceLabel: 'Дистанция, км',
    distancePlaceholder: '5,2',
    durationLabel: 'Время (необязательно)',
    durationPlaceholder: 'мм:сс или ч:мм:сс',
    valueLabel: 'Дистанция',
    durationHint: 'Например 26:30 или 1:05:00',
  },
  en: {
    distanceLabel: 'Distance, km',
    distancePlaceholder: '5.2',
    durationLabel: 'Time (optional)',
    durationPlaceholder: 'mm:ss or h:mm:ss',
    valueLabel: 'Distance',
    durationHint: 'E.g. 26:30 or 1:05:00',
  },
} as const;
