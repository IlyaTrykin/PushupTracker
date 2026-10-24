/**
 * Profile as a list of sections (R12/R14) and the side menu with the «Админка» level (R12.1).
 * Used as `profileSectionsMessages[locale]`; `{x}` placeholders are filled with `fillProfileText`.
 */
export const profileSectionsMessages = {
  ru: {
    listLabel: 'Разделы профиля',
    sections: {
      personal: { title: 'Персональная информация', hint: 'Аватар, ник, вес и рост, язык, часовой пояс' },
      training: { title: 'Тренировки', hint: 'Цель дня, напоминание, мои упражнения' },
      health: { title: 'Здоровье', hint: 'Apple Health / Health Connect, калории, импорт' },
      notifications: { title: 'Уведомления', hint: 'Push, e-mail, Telegram' },
      security: { title: 'Безопасность', hint: 'Смена пароля, заблокированные' },
      docs: { title: 'Документы и поддержка', hint: 'Конфиденциальность, условия, поддержка' },
      account: { title: 'Аккаунт', hint: 'Выход, удаление профиля' },
    },
    values: {
      goal: 'Цель {goal} баллов',
      noGoal: 'Цель не задана',
      healthOn: 'Вкл.',
      healthOff: 'Выкл.',
    },
    personal: {
      heightCm: 'Рост (см)',
      fromHealth: 'из Health',
      fromHealthInfoTitle: 'Вес и рост из Health',
      fromHealthInfo:
        'Значение с меткой «из Health» пришло из Apple Health / Health Connect: при следующем замере там оно обновится само. Если поправить вручную, сохранится ваше значение — до более свежего замера в Health.',
      bodyInfoTitle: 'Зачем вес и рост',
      bodyInfo: 'По весу, росту, возрасту и полу считаются калории тренировок. Их видите только вы.',
      saved: 'Сохранено',
      weightInvalid: 'Вес — от 30 до 250 кг',
      heightInvalid: 'Рост — от 100 до 250 см',
      timeZoneInfoTitle: 'Часовой пояс',
    },
    training: {
      myExercises: 'Мои упражнения',
      myExercisesValue: '{count} из {limit}',
    },
    security: {
      passwordChanged: 'Пароль изменён',
    },
    account: {
      logout: 'Выйти из аккаунта',
      logoutHint: 'Тренировки останутся на сервере; войти можно снова в любой момент.',
      deleteTitle: 'Удаление профиля',
    },
    menu: {
      admin: 'Админка',
      adminUsers: 'Пользователи',
      adminGrowth: 'Статистика роста',
    },
  },
  en: {
    listLabel: 'Profile sections',
    sections: {
      personal: { title: 'Personal information', hint: 'Avatar, username, weight and height, language, time zone' },
      training: { title: 'Training', hint: 'Daily goal, reminder, my exercises' },
      health: { title: 'Health', hint: 'Apple Health / Health Connect, calories, import' },
      notifications: { title: 'Notifications', hint: 'Push, e-mail, Telegram' },
      security: { title: 'Security', hint: 'Change password, blocked users' },
      docs: { title: 'Documents and support', hint: 'Privacy, terms, support' },
      account: { title: 'Account', hint: 'Sign out, delete profile' },
    },
    values: {
      goal: 'Goal {goal} points',
      noGoal: 'No goal set',
      healthOn: 'On',
      healthOff: 'Off',
    },
    personal: {
      heightCm: 'Height (cm)',
      fromHealth: 'from Health',
      fromHealthInfoTitle: 'Weight and height from Health',
      fromHealthInfo:
        'A value marked «from Health» came from Apple Health / Health Connect and updates itself with the next measurement there. If you correct it by hand, your value is kept until a newer measurement in Health.',
      bodyInfoTitle: 'Why weight and height',
      bodyInfo: 'Workout calories are counted from your weight, height, age and sex. Only you see them.',
      saved: 'Saved',
      weightInvalid: 'Weight must be 30 to 250 kg',
      heightInvalid: 'Height must be 100 to 250 cm',
      timeZoneInfoTitle: 'Time zone',
    },
    training: {
      myExercises: 'My exercises',
      myExercisesValue: '{count} of {limit}',
    },
    security: {
      passwordChanged: 'Password changed',
    },
    account: {
      logout: 'Sign out',
      logoutHint: 'Your workouts stay on the server; you can sign in again at any time.',
      deleteTitle: 'Delete profile',
    },
    menu: {
      admin: 'Admin',
      adminUsers: 'Users',
      adminGrowth: 'Growth statistics',
    },
  },
} as const;

export function fillProfileText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
