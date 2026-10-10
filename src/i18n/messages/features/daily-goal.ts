/**
 * Daily goal (F1): profile fields, the dashboard ring and the evening reminder.
 * Used as `dailyGoalMessages[locale]`. `{x}` placeholders are filled by `fillDailyGoalText`.
 */
export const dailyGoalMessages = {
  ru: {
    sectionTitle: 'Цель дня',
    sectionHint: 'Баллы за день по всем упражнениям (1 балл = 1 отжимание). Если к времени напоминания цель не выполнена, придёт уведомление.',
    goalLabel: 'Цель, баллов в день',
    goalPlaceholder: 'например, 100',
    goalHint: 'От 10 до 2000. Пусто — цель выключена.',
    reminderLabel: 'Время напоминания',
    timeZoneLabel: 'Часовой пояс',
    timeZoneHint: 'Определяется по браузеру автоматически; можно поменять.',
    save: 'Сохранить цель',
    saved: 'Сохранено',
    ringTitle: 'Цель дня',
    ringProgress: 'сегодня {done} из {goal} баллов',
    ringReached: 'Цель выполнена',
    ringRemaining: 'осталось {remaining}',
    setGoal: 'Поставить цель дня',
    setGoalHint: 'Сколько баллов в день — и напомню вечером',
    reminderTitle: 'Цель дня',
    reminderBody: 'Осталось {remaining} {pointsWord} до цели: сегодня {done} из {goal}.',
    /** Plural forms of «балл»: 1, 2–4, 5+ (fractions use the second). */
    pointsWords: ['балл', 'балла', 'баллов'],
    errors: {
      goal: 'Цель дня — целое число от 10 до 2000 баллов или пусто',
      reminderTime: 'Время напоминания — в формате ЧЧ:ММ',
    },
  },
  en: {
    sectionTitle: 'Daily goal',
    sectionHint: 'Points per day across all exercises (1 point = 1 push-up). If the goal is not reached by the reminder time, you get a notification.',
    goalLabel: 'Goal, points per day',
    goalPlaceholder: 'e.g. 100',
    goalHint: 'From 10 to 2000. Empty turns the goal off.',
    reminderLabel: 'Reminder time',
    timeZoneLabel: 'Time zone',
    timeZoneHint: 'Detected from the browser automatically; you can change it.',
    save: 'Save goal',
    saved: 'Saved',
    ringTitle: 'Daily goal',
    ringProgress: 'today {done} of {goal} points',
    ringReached: 'Goal reached',
    ringRemaining: '{remaining} to go',
    setGoal: 'Set a daily goal',
    setGoalHint: 'Points per day — and an evening reminder',
    reminderTitle: 'Daily goal',
    reminderBody: '{remaining} {pointsWord} left to your goal: {done} of {goal} today.',
    pointsWords: ['point', 'points', 'points'],
    errors: {
      goal: 'Daily goal must be a whole number from 10 to 2000 points, or empty',
      reminderTime: 'Reminder time must be HH:MM',
    },
  },
} as const;

export function fillDailyGoalText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
