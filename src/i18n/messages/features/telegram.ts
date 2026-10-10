/**
 * Telegram bot (F9): the profile section and the bot's replies.
 * Used as `telegramMessages[locale]`; `{x}` placeholders are filled by `fillTelegramText`.
 */
export const telegramMessages = {
  ru: {
    sectionTitle: 'Telegram',
    sectionHint: 'Записывай тренировки сообщением боту и получай уведомления в Telegram.',
    connect: 'Подключить Telegram',
    connecting: 'Создаю ссылку…',
    openBot: 'Открыть бота',
    linkHint: 'Ссылка одноразовая и действует 15 минут: открой её и нажми «Start» в боте.',
    waiting: 'Жду подтверждения из Telegram…',
    connected: 'Telegram подключён',
    connectedSince: 'с {date}',
    connectedHint: 'Пиши боту «30», «планка 60», «бег 5,2» — тренировка запишется. Какие уведомления присылать в Telegram — выбери ниже.',
    disconnect: 'Отключить',
    disconnecting: 'Отключаю…',
    loadFailed: 'Не удалось загрузить состояние Telegram',
    connectFailed: 'Не удалось создать ссылку',
    disconnectFailed: 'Не удалось отключить Telegram',

    bot: {
      linked: 'Подключено, {username}! Теперь можно записывать тренировки сообщением.',
      linkInvalid: 'Ссылка устарела или уже использована. Создай новую в профиле: {url}',
      notLinked: 'Этот чат не подключён к аккаунту. Открой профиль в приложении и нажми «Подключить Telegram»: {url}',
      unlinked: 'Telegram отключён. Подключить снова можно в профиле приложения.',
      unlinkedFromApp: 'Telegram отключён в профиле приложения.',
      help: [
        'Пиши тренировки сообщением:',
        '• 30 — {favorite} (первое упражнение из избранных)',
        '• 30 приседания или приседания 30',
        '• планка 60 или планка 1:30',
        '• бег 5,2 или бег 5,2 26:30 (км и время)',
        '• жим 10 24кг — упражнения с гирей',
        '',
        '/today — итог дня',
        '/stop — отключить бота',
      ].join('\n'),
      unknown: 'Не понял. Напиши /help — там примеры.',
      recorded: 'Записал: {what} (+{points} {pointsWord}).',
      goalLine: 'Цель дня: {done}/{goal}',
      goalReached: 'Цель дня выполнена: {done}/{goal} ✅',
      todayTitle: 'Сегодня: {points} {pointsWord}',
      todayEmpty: 'Сегодня тренировок пока нет.',
      needWeight: 'Укажи вес гири, например: «{example}».',
      errorValue: 'Не получилось записать: значение вне допустимых пределов.',
      errorDuration: 'Не получилось записать: время указывается как мм:сс или ч:мм:сс.',
      errorRateLimited: 'Слишком много записей за сутки. Попробуй позже.',
      errorGeneric: 'Не получилось записать, попробуй ещё раз.',
      /** Plural forms of «балл»: 1, 2–4, 5+ (fractions use the second). */
      pointsWords: ['балл', 'балла', 'баллов'],
    },
  },
  en: {
    sectionTitle: 'Telegram',
    sectionHint: 'Log workouts by messaging the bot and get notifications in Telegram.',
    connect: 'Connect Telegram',
    connecting: 'Creating a link…',
    openBot: 'Open the bot',
    linkHint: 'The link works once and for 15 minutes: open it and press “Start” in the bot.',
    waiting: 'Waiting for Telegram…',
    connected: 'Telegram connected',
    connectedSince: 'since {date}',
    connectedHint: 'Send the bot “30”, “plank 60”, “run 5.2” and the workout is logged. Choose which notifications go to Telegram below.',
    disconnect: 'Disconnect',
    disconnecting: 'Disconnecting…',
    loadFailed: 'Could not load the Telegram state',
    connectFailed: 'Could not create a link',
    disconnectFailed: 'Could not disconnect Telegram',

    bot: {
      linked: 'Connected, {username}! Now you can log workouts by message.',
      linkInvalid: 'The link has expired or was already used. Create a new one in your profile: {url}',
      notLinked: 'This chat is not connected to an account. Open your profile in the app and press “Connect Telegram”: {url}',
      unlinked: 'Telegram disconnected. You can connect it again in your profile.',
      unlinkedFromApp: 'Telegram was disconnected in the app profile.',
      help: [
        'Log workouts by message:',
        '• 30 — {favorite} (your first favourite exercise)',
        '• 30 squats or squats 30',
        '• plank 60 or plank 1:30',
        '• run 5.2 or run 5.2 26:30 (km and time)',
        '• press 10 24kg — kettlebell exercises',
        '',
        '/today — today’s summary',
        '/stop — disconnect the bot',
      ].join('\n'),
      unknown: 'Sorry, I did not get that. Send /help for examples.',
      recorded: 'Logged: {what} (+{points} {pointsWord}).',
      goalLine: 'Daily goal: {done}/{goal}',
      goalReached: 'Daily goal reached: {done}/{goal} ✅',
      todayTitle: 'Today: {points} {pointsWord}',
      todayEmpty: 'No workouts today yet.',
      needWeight: 'Add the kettlebell weight, e.g. “{example}”.',
      errorValue: 'Not logged: the value is out of range.',
      errorDuration: 'Not logged: time is mm:ss or h:mm:ss.',
      errorRateLimited: 'Too many entries in 24 hours. Try later.',
      errorGeneric: 'Not logged, please try again.',
      pointsWords: ['point', 'points', 'points'],
    },
  },
} as const;

export type TelegramLocale = keyof typeof telegramMessages;

export function fillTelegramText(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}
