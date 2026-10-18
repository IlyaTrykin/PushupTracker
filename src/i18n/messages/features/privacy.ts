/**
 * Privacy policy page (`/privacy`) and the link to it from the profile.
 * DRAFT: the text describes what the app really collects; the operator's name, contact email and
 * address are visible placeholders `[ВПИСАТЬ: …]` / `[FILL IN: …]`. Review before publishing.
 */
type Section = { title: string; paragraphs?: readonly string[]; items?: readonly string[] };

export const privacyMessages = {
  ru: {
    metaTitle: 'Политика конфиденциальности — Pushup Tracker',
    draftBadge: '[ЧЕРНОВИК — проверить перед публикацией]',
    title: 'Политика конфиденциальности',
    updated: 'Редакция от [ВПИСАТЬ: дата]',
    profileLink: 'Политика конфиденциальности',
    profileHint: 'Какие данные мы храним и зачем.',
    intro:
      'Pushup Tracker — сайт и приложения для iPhone и Android, в которых вы записываете тренировки, считаете баллы и соревнуетесь с друзьями. Здесь описано, какие данные мы собираем и что с ними делаем.',
    sections: [
      {
        title: 'Кто отвечает за данные',
        paragraphs: [
          'Оператор: [ВПИСАТЬ: имя или название оператора].',
          'Контакт по вопросам данных: [ВПИСАТЬ: контактный email]. Адрес: [ВПИСАТЬ: адрес оператора].',
        ],
      },
      {
        title: 'Какие данные мы собираем',
        items: [
          'Аккаунт: логин, email и пароль (хранится только в виде хеша, сам пароль мы не знаем). Необязательно: пол, дата рождения, вес, аватар.',
          'Тренировки: упражнение, число повторений или дистанция, длительность, время и день; баллы считаются из них.',
          'Часовой пояс и язык: чтобы правильно определять день тренировки и показывать интерфейс на вашем языке.',
          'Друзья, группы, челленджи и реакции: кого вы добавили, в каких группах состоите, ваши реакции и участие в челленджах. Эти сведения видны тем участникам, с которыми вы связаны.',
          'Сессия входа: в приложении токен сессии хранится в защищённом хранилище телефона (Keychain на iPhone, зашифрованное хранилище на Android); на сайте — cookie.',
          'Токены уведомлений: если вы включили пуши, мы храним токен вашего устройства (APNs на iPhone, Firebase Cloud Messaging на Android) и подписки веб-пушей, чтобы отправлять напоминания и сообщения о событиях.',
          'Telegram: если вы привязали бота, мы храним идентификатор вашего чата, чтобы отправлять туда уведомления.',
          'Технические данные: служебные журналы сервера (время запроса, адрес, код ответа) для безопасности и отладки.',
        ],
      },
      {
        title: 'Данные Apple Health и Health Connect',
        paragraphs: [
          'Доступ к «Здоровью» (iPhone) и Health Connect (Android) включается только по вашему разрешению и в любой момент отключается в настройках телефона.',
        ],
        items: [
          'Что мы записываем: ваши тренировки из Pushup Tracker — тип, время начала и конца, длительность и дистанцию (для бега, велосипеда и гребли).',
          'Что мы читаем: тренировки бега, велосипеда и гребли и их дистанцию, чтобы вы могли импортировать их в Pushup Tracker и чтобы не записывать одно и то же дважды. Импорт идёт только по вашему действию на экране импорта; записи, сделанные самим приложением, пропускаются.',
          'Мы не продаём эти данные, не передаём их рекламным сетям и брокерам данных и не используем для рекламы, профилирования или оценки кредитоспособности.',
          'На iPhone мы не сохраняем данные «Здоровья» в iCloud. На сервер попадают только тренировки, которые вы импортировали или записали в Pushup Tracker сами.',
        ],
      },
      {
        title: 'Камера и датчик приближения',
        paragraphs: [
          'Камера нужна только для счёта повторений по положению тела. Кадры обрабатываются на самом телефоне, не сохраняются и никуда не отправляются; на сервер уходит лишь число повторений. Датчик приближения используется только для счёта повторений и ничего не записывает.',
        ],
      },
      {
        title: 'Зачем мы используем данные',
        items: [
          'чтобы работал ваш аккаунт, тренировки, баллы, серии, друзья, группы и челленджи;',
          'чтобы отправлять напоминания и уведомления о событиях, которые вы включили;',
          'чтобы защищать сервис от злоупотреблений и исправлять ошибки.',
        ],
        paragraphs: ['Мы не показываем рекламу и не продаём персональные данные.'],
      },
      {
        title: 'Кому данные передаются',
        paragraphs: [
          'Данные хранятся на сервере оператора. Для доставки уведомлений токены устройств и текст уведомления проходят через Apple (APNs), Google (Firebase Cloud Messaging) и, если вы привязали бота, Telegram; письма уходят через почтовый сервис. Больше никому мы данные не передаём, кроме случаев, когда этого требует закон.',
        ],
      },
      {
        title: 'Хранение и удаление',
        paragraphs: [
          'Данные хранятся, пока существует аккаунт. Удалить аккаунт можно в профиле — кнопкой «Удалить профиль»; вместе с ним удаляются ваши тренировки и связанные данные, а токены устройств перестают использоваться. Записи, которые приложение сделало в «Здоровье» или Health Connect, остаются на телефоне: удалить их можно в приложении «Здоровье» или Health Connect.',
          'Чтобы запросить копию данных или удаление, напишите на [ВПИСАТЬ: контактный email].',
        ],
      },
      {
        title: 'Дети',
        paragraphs: ['Сервис не предназначен для детей младше [ВПИСАТЬ: возраст]. Мы сознательно не собираем их данные.'],
      },
      {
        title: 'Изменения',
        paragraphs: ['Если политика изменится, мы обновим дату редакции на этой странице.'],
      },
    ] as readonly Section[],
  },
  en: {
    metaTitle: 'Privacy Policy — Pushup Tracker',
    draftBadge: '[DRAFT — review before publishing]',
    title: 'Privacy Policy',
    updated: 'Version of [FILL IN: date]',
    profileLink: 'Privacy policy',
    profileHint: 'What data we keep and why.',
    intro:
      'Pushup Tracker is a website and apps for iPhone and Android where you log workouts, earn points and compete with friends. This page explains what data we collect and what we do with it.',
    sections: [
      {
        title: 'Who is responsible for the data',
        paragraphs: [
          'Operator: [FILL IN: operator name].',
          'Contact for data questions: [FILL IN: contact email]. Address: [FILL IN: operator address].',
        ],
      },
      {
        title: 'What we collect',
        items: [
          'Account: username, email and password (stored only as a hash; we never know the password itself). Optional: gender, birth date, weight, avatar.',
          'Workouts: exercise, repetitions or distance, duration, time and day; points are calculated from them.',
          'Time zone and language: to work out the day of a workout correctly and to show the interface in your language.',
          'Friends, groups, challenges and reactions: who you added, which groups you belong to, your reactions and challenge participation. This is visible to the members you are connected with.',
          'Sign-in session: in the app the session token is kept in the phone\'s secure storage (Keychain on iPhone, encrypted storage on Android); on the website it is a cookie.',
          'Notification tokens: if you turn push notifications on, we store your device token (APNs on iPhone, Firebase Cloud Messaging on Android) and web-push subscriptions to send reminders and event notifications.',
          'Telegram: if you link the bot, we store your chat identifier to send notifications there.',
          'Technical data: server logs (request time, address, response code) for security and debugging.',
        ],
      },
      {
        title: 'Apple Health and Health Connect data',
        paragraphs: [
          'Access to Apple Health (iPhone) and Health Connect (Android) is enabled only with your permission and can be turned off at any time in the phone settings.',
        ],
        items: [
          'What we write: your Pushup Tracker workouts: type, start and end time, duration and distance (for running, cycling and rowing).',
          'What we read: running, cycling and rowing workouts and their distance, so you can import them into Pushup Tracker and so the same workout is not recorded twice. Import happens only when you start it on the import screen; records written by this app are skipped.',
          'We do not sell this data, do not share it with ad networks or data brokers, and do not use it for advertising, profiling or credit decisions.',
          'On iPhone we do not store Health data in iCloud. Only the workouts you imported or logged in Pushup Tracker yourself reach our server.',
        ],
      },
      {
        title: 'Camera and proximity sensor',
        paragraphs: [
          'The camera is used only to count repetitions from body position. Frames are processed on the phone itself, are not saved and are never sent anywhere; only the repetition count goes to the server. The proximity sensor is used only to count repetitions and records nothing.',
        ],
      },
      {
        title: 'Why we use the data',
        items: [
          'to run your account, workouts, points, streaks, friends, groups and challenges;',
          'to send reminders and notifications about events you turned on;',
          'to protect the service from abuse and to fix bugs.',
        ],
        paragraphs: ['We show no ads and do not sell personal data.'],
      },
      {
        title: 'Who receives the data',
        paragraphs: [
          'Data is stored on the operator\'s server. To deliver notifications, device tokens and the notification text pass through Apple (APNs), Google (Firebase Cloud Messaging) and, if you linked the bot, Telegram; emails go through a mail service. We share data with no one else except where the law requires it.',
        ],
      },
      {
        title: 'Retention and deletion',
        paragraphs: [
          'Data is kept while your account exists. You can delete the account in your profile with the "Delete profile" button; your workouts and related data are deleted with it and device tokens stop being used. Records the app wrote to Apple Health or Health Connect stay on your phone: delete them in Apple Health or Health Connect.',
          'To request a copy of your data or its deletion, write to [FILL IN: contact email].',
        ],
      },
      {
        title: 'Children',
        paragraphs: ['The service is not intended for children under [FILL IN: age]. We do not knowingly collect their data.'],
      },
      {
        title: 'Changes',
        paragraphs: ['If this policy changes, we will update the version date on this page.'],
      },
    ] as readonly Section[],
  },
} as const;
