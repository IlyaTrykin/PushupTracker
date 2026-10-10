/** Challenges with weighted exercises (scored in points). Used as `challengesMessages[locale]`. */
export const challengesMessages = {
  ru: {
    pointsHintCreate: 'Упражнение с весом: суммы и дневная норма считаются в баллах (1 балл = 1 отжимание), больший вес даёт больше.',
    pointsHintDetails: 'Упражнение с весом: считается в баллах (1 балл = 1 отжимание).',
    leave: 'Отказаться',
    leaveConfirm: 'Выйти из челленджа?',
    leftInfo: 'Вы вышли из челленджа',
  },
  en: {
    pointsHintCreate: 'Weighted exercise: totals and daily targets are counted in points (1 point = 1 push-up), so heavier weight counts more.',
    pointsHintDetails: 'Weighted exercise: counted in points (1 point = 1 push-up).',
    leave: 'Leave',
    leaveConfirm: 'Leave this challenge?',
    leftInfo: 'You left the challenge',
  },
} as const;
