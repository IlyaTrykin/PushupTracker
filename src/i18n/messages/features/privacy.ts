/**
 * Privacy policy page (`/privacy`) and the link to it from the profile.
 * Operator name and contact email are NOT here (the repository is public): `{operator}` and
 * `{email}` are filled in at request time from env `LEGAL_OPERATOR_NAME` / `LEGAL_CONTACT_EMAIL`
 * (see `src/lib/legal.ts`); when they are empty the page shows a visible placeholder.
 */
export type LegalSection = { title: string; paragraphs?: readonly string[]; items?: readonly string[] };

export const privacyMessages = {
  ru: {
    metaTitle: 'Политика конфиденциальности — Pushup Tracker',
    title: 'Политика конфиденциальности',
    updated: 'Редакция от 19 октября 2026',
    profileLink: 'Политика конфиденциальности',
    profileHint: 'Какие данные мы храним и зачем.',
    intro:
      'Pushup Tracker — сайт и приложения для iPhone и Android, в которых вы записываете тренировки, считаете баллы и соревнуетесь с друзьями. Здесь описано, какие данные мы собираем, зачем и как вы можете ими управлять.',
    sections: [
      {
        title: 'Кто отвечает за данные',
        paragraphs: [
          'Оператор: {operator}.',
          'По любым вопросам о данных пишите на {email}. Почтового адреса у оператора нет, связь только по электронной почте.',
        ],
      },
      {
        title: 'Возраст',
        paragraphs: [
          'Сервис рассчитан на пользователей от 5 лет. Дети младше 14 лет пользуются им только с согласия родителя или законного представителя, который регистрирует ребёнка либо разрешает ему регистрацию. Если вы родитель и считаете, что ребёнок зарегистрировался без вашего согласия, напишите на {email} — мы закроем аккаунт и удалим данные.',
        ],
      },
      {
        title: 'Какие данные мы собираем',
        items: [
          'Аккаунт: логин, email и пароль (хранится только в виде хеша, сам пароль мы не знаем). Необязательно: пол, дата рождения, вес, рост, аватар, дневная цель и время напоминания, любимые упражнения.',
          'Тренировки: упражнение, число повторений или дистанция, длительность, время и день; из них считаются баллы, серии и достижения. Если в профиле указан вес, у каждой тренировки хранятся её активные калории — их видите только вы. Тренировки, импортированные из Apple Health или Health Connect, помечены источником.',
          'Часовой пояс и язык: чтобы правильно определять день тренировки и показывать интерфейс на вашем языке.',
          'Друзья, группы, челленджи и реакции: кого вы добавили, в каких группах состоите, ваши реакции и участие в челленджах. Эти сведения, включая ваши тренировки, видны тем участникам, с которыми вы связаны.',
          'Жалобы и блокировки: если вы заблокировали пользователя, мы храним сам факт блокировки (она скрывает вас друг от друга). Если вы пожаловались на пользователя, мы храним причину, ваш необязательный комментарий и объект жалобы; жалоба передаётся администратору сервиса и дублируется ему письмом.',
          'Сообщения обратной связи: текст, который вы отправили через форму, вместе с вашим логином и email приходит оператору на почту.',
          'Источник регистрации: ссылка-приглашение или метки utm, по которым вы пришли, — чтобы понимать, откуда приходят пользователи.',
          'Сессия входа: на сайте — cookie сессии и cookie выбранного языка; в приложении токен сессии хранится в защищённом хранилище телефона (Keychain на iPhone, зашифрованное хранилище на Android). Сессия на сайте действует 30 дней, в приложении — 180.',
          'Данные на вашем устройстве: в приложении есть офлайн-очередь — тренировки, записанные без сети, лежат в памяти приложения, пока не отправятся на сервер; там же хранятся настройки (например, включены ли пуши и запись в «Здоровье»). Всё это удаляется при выходе из аккаунта или удалении приложения.',
          'Уведомления: если вы включили пуши, мы храним подписки веб-пушей и токен вашего устройства (APNs на iPhone, Firebase Cloud Messaging на Android), а также историю уведомлений в самом сервисе.',
          'Telegram: если вы привязали бота, мы храним идентификатор вашего чата, чтобы отправлять туда уведомления и принимать тренировки.',
          'Технические данные: служебные журналы сервера (время запроса, адрес, код ответа) и счётчики ограничения частоты запросов — для безопасности и отладки.',
        ],
      },
      {
        title: 'Данные Apple Health и Health Connect',
        paragraphs: [
          'Доступ к «Здоровью» (iPhone) и Health Connect (Android) включается только по вашему разрешению и в любой момент отключается в настройках телефона. Пользоваться Pushup Tracker можно и без него.',
        ],
        items: [
          'Что мы записываем: ваши тренировки из Pushup Tracker — тип, время начала и конца, длительность, дистанцию (для бега, велосипеда и гребли) и активные калории (на iPhone они идут в кольцо «Подвижность»). Передачу калорий можно выключить в профиле, в разделе «Здоровье».',
          'Что мы читаем: тренировки бега, велосипеда и гребли и их дистанцию, чтобы вы могли импортировать их в Pushup Tracker и чтобы не записывать одно и то же дважды. Импорт идёт только по вашему действию на экране импорта; записи, сделанные самим приложением, пропускаются.',
          'Данные тела: вес и рост (на iPhone — ещё дата рождения и пол) читаются только для расчёта калорий ваших тренировок и попадают в ваш профиль: вес и рост — если замер в Health свежее, чем в профиле, дата рождения и пол — только если в профиле их нет. Health Connect дату рождения и пол не хранит. Другие данные о здоровье (пульс, шаги, сон) мы не читаем.',
          'Данные Health не используются для рекламы, маркетинга, профилирования или оценки кредитоспособности и не передаются третьим лицам: мы не продаём их, не отдаём рекламным сетям, брокерам данных и страховщикам.',
          'На iPhone мы не сохраняем данные «Здоровья» в iCloud. На сервер попадают только тренировки, которые вы импортировали или записали в Pushup Tracker сами, и вес, рост, дата рождения и пол в вашем профиле; остальные данные «Здоровья» остаются на телефоне.',
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
          'чтобы работали ваш аккаунт, тренировки, баллы, серии, друзья, группы и челленджи;',
          'чтобы отправлять напоминания и уведомления о событиях, которые вы включили, и письма (подтверждение, сброс пароля);',
          'чтобы рассматривать жалобы, ограничивать злоупотребления и защищать сервис;',
          'чтобы исправлять ошибки и отвечать на ваши обращения.',
        ],
        paragraphs: ['Мы не показываем рекламу, не используем сторонние рекламные и аналитические трекеры и не продаём персональные данные.'],
      },
      {
        title: 'Кому данные передаются',
        paragraphs: [
          'Данные хранятся на сервере оператора. Для доставки уведомлений токены устройств и текст уведомления проходят через Apple (APNs), Google (Firebase Cloud Messaging), браузерные push-службы и, если вы привязали бота, Telegram; письма уходят через почтовый сервис. Другим лицам данные не передаются, кроме случаев, когда этого требует закон.',
          'Участники, с которыми вы связаны (друзья, участники ваших групп и челленджей), видят ваш логин, аватар и тренировки в пределах функций сервиса. Заблокированные вами пользователи и пользователи, заблокировавшие вас, друг друга не видят.',
        ],
      },
      {
        title: 'Хранение и удаление',
        paragraphs: [
          'Данные хранятся, пока существует аккаунт. Удалить аккаунт можно в профиле кнопкой «Удалить профиль»: вход закрывается сразу, все сессии завершаются, ваш профиль и тренировки перестают быть видны другим. Полное удаление данных с сервера выполняется по вашему запросу на {email} — мы удаляем аккаунт и связанные данные (тренировки, друзей, группы, реакции, жалобы и блокировки, токены устройств) в течение 30 дней и подтверждаем это письмом. Подробности — на странице удаления аккаунта.',
          'Уведомления в сервисе хранятся 180 дней, сессии, токены сброса пароля и коды привязки Telegram удаляются после истечения срока. Резервные копии сервера могут содержать удалённые данные ещё до 30 дней.',
          'Записи, которые приложение сделало в «Здоровье» или Health Connect, остаются на телефоне: удалить их можно в приложении «Здоровье» или Health Connect.',
          'Чтобы получить копию своих данных, исправить их или удалить, напишите на {email}.',
        ],
      },
      {
        title: 'Изменения',
        paragraphs: ['Если политика изменится, мы обновим дату редакции на этой странице.'],
      },
    ] as readonly LegalSection[],
  },
  en: {
    metaTitle: 'Privacy Policy — Pushup Tracker',
    title: 'Privacy Policy',
    updated: 'Version of 19 October 2026',
    profileLink: 'Privacy policy',
    profileHint: 'What data we keep and why.',
    intro:
      'Pushup Tracker is a website and apps for iPhone and Android where you log workouts, earn points and compete with friends. This page explains what data we collect, why, and how you can control it.',
    sections: [
      {
        title: 'Who is responsible for the data',
        paragraphs: [
          'Operator: {operator}.',
          'For any data question write to {email}. The operator has no postal address; contact is by email only.',
        ],
      },
      {
        title: 'Age',
        paragraphs: [
          'The service is intended for users aged 5 and over. Children under 14 may use it only with the consent of a parent or legal guardian, who registers the child or permits the registration. If you are a parent and believe your child registered without your consent, write to {email} and we will close the account and delete the data.',
        ],
      },
      {
        title: 'What we collect',
        items: [
          'Account: username, email and password (stored only as a hash; we never know the password itself). Optional: gender, birth date, weight, height, avatar, daily goal and reminder time, favourite exercises.',
          'Workouts: exercise, repetitions or distance, duration, time and day; points, streaks and achievements are calculated from them. Workouts imported from Apple Health or Health Connect are marked with their source. If your profile has a weight, every workout keeps its active calories, visible only to you.',
          'Time zone and language: to work out the day of a workout correctly and to show the interface in your language.',
          'Friends, groups, challenges and reactions: who you added, which groups you belong to, your reactions and challenge participation. This, including your workouts, is visible to the members you are connected with.',
          'Reports and blocks: if you block a user we store the fact of the block (it hides you from each other). If you report a user we store the reason, your optional comment and the reported item; the report goes to the service administrator and is also emailed to them.',
          'Feedback messages: the text you send through the form reaches the operator by email together with your username and email.',
          'Signup source: the invite link or utm tags you came from, to understand where users come from.',
          'Sign-in session: on the website a session cookie and a language cookie; in the app the session token is kept in the phone\'s secure storage (Keychain on iPhone, encrypted storage on Android). A website session lasts 30 days, an app session 180.',
          'Data on your device: the app has an offline queue: workouts logged without a connection are kept in the app\'s storage until they reach the server; settings (for example whether push and Health writing are on) are kept there too. All of this is removed when you sign out or uninstall the app.',
          'Notifications: if you turn push on, we store web-push subscriptions and your device token (APNs on iPhone, Firebase Cloud Messaging on Android), as well as the in-app notification history.',
          'Telegram: if you link the bot, we store your chat identifier to send notifications there and accept workouts.',
          'Technical data: server logs (request time, address, response code) and rate-limit counters, for security and debugging.',
        ],
      },
      {
        title: 'Apple Health and Health Connect data',
        paragraphs: [
          'Access to Apple Health (iPhone) and Health Connect (Android) is enabled only with your permission and can be turned off at any time in the phone settings. Pushup Tracker works without it.',
        ],
        items: [
          'What we write: your Pushup Tracker workouts: type, start and end time, duration, distance (for running, cycling and rowing) and active calories (on iPhone they count towards the Move ring). Sending calories can be turned off in your profile, in the Health section.',
          'What we read: running, cycling and rowing workouts and their distance, so you can import them into Pushup Tracker and so the same workout is not recorded twice. Import happens only when you start it on the import screen; records written by this app are skipped.',
          'Body data: weight and height (on iPhone also date of birth and sex) are read only to calculate the calories of your workouts and go into your profile: weight and height when the Health measurement is newer than your profile, date of birth and sex only when your profile has none. Health Connect keeps no date of birth or sex. We read no other health data (heart rate, steps, sleep).',
          'Health data is not used for advertising, marketing, profiling or credit decisions and is not shared with third parties: we do not sell it or give it to ad networks, data brokers or insurers.',
          'On iPhone we do not store Health data in iCloud. Only the workouts you imported or logged in Pushup Tracker yourself and the weight, height, date of birth and sex in your profile reach our server; the rest of your Health data stays on the phone.',
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
          'to send reminders and notifications about events you turned on, and emails (confirmation, password reset);',
          'to handle reports, limit abuse and protect the service;',
          'to fix bugs and answer your requests.',
        ],
        paragraphs: ['We show no ads, use no third-party advertising or analytics trackers and do not sell personal data.'],
      },
      {
        title: 'Who receives the data',
        paragraphs: [
          'Data is stored on the operator\'s server. To deliver notifications, device tokens and the notification text pass through Apple (APNs), Google (Firebase Cloud Messaging), browser push services and, if you linked the bot, Telegram; emails go through a mail service. Data is not given to anyone else except where the law requires it.',
          'Members you are connected with (friends, members of your groups and challenges) see your username, avatar and workouts within the features of the service. Users you blocked and users who blocked you do not see each other.',
        ],
      },
      {
        title: 'Retention and deletion',
        paragraphs: [
          'Data is kept while your account exists. You can delete the account in your profile with the "Delete profile" button: sign-in is closed immediately, all sessions end, and your profile and workouts are no longer visible to others. Full removal of the data from the server is done on your request to {email}: we delete the account and related data (workouts, friends, groups, reactions, reports and blocks, device tokens) within 30 days and confirm by email. Details are on the account deletion page.',
          'In-app notifications are kept for 180 days; sessions, password-reset tokens and Telegram link codes are deleted after they expire. Server backups may still contain deleted data for up to 30 days.',
          'Records the app wrote to Apple Health or Health Connect stay on your phone: delete them in Apple Health or Health Connect.',
          'To get a copy of your data, correct it or delete it, write to {email}.',
        ],
      },
      {
        title: 'Changes',
        paragraphs: ['If this policy changes, we will update the version date on this page.'],
      },
    ] as readonly LegalSection[],
  },
} as const;
