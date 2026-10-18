/**
 * Legal pages other than the privacy policy: `/terms`, `/support`, `/account-deletion`, plus the
 * labels shared by all legal pages. `{operator}` / `{email}` are filled from env at request time
 * (`src/lib/legal.ts`); nothing personal lives in this file.
 */
import type { LegalSection } from './privacy';

export const legalMessages = {
  ru: {
    placeholderOperator: '[ОПЕРАТОР НЕ ЗАДАН — укажите LEGAL_OPERATOR_NAME на сервере]',
    placeholderEmail: '[EMAIL НЕ ЗАДАН — укажите LEGAL_CONTACT_EMAIL на сервере]',
    navTitle: 'Документы и поддержка',
    navPrivacy: 'Политика конфиденциальности',
    navTerms: 'Условия использования',
    navSupport: 'Поддержка',
    navDeletion: 'Удаление аккаунта',
    profileHint: 'Политика конфиденциальности, условия использования, поддержка и удаление аккаунта.',
    writeToUs: 'Написать на {email}',
    terms: {
      metaTitle: 'Условия использования — Pushup Tracker',
      title: 'Условия использования',
      updated: 'Редакция от 18 октября 2026',
      intro:
        'Эти условия описывают, как можно пользоваться сайтом и приложениями Pushup Tracker. Регистрируясь и пользуясь сервисом, вы соглашаетесь с ними.',
      sections: [
        {
          title: 'Кто мы',
          paragraphs: ['Сервис ведёт {operator}. Вопросы — на {email}.'],
        },
        {
          title: 'Возраст и аккаунт',
          paragraphs: [
            'Сервис рассчитан на пользователей от 5 лет. Дети младше 14 лет пользуются им с согласия родителя или законного представителя.',
            'Вы отвечаете за сохранность пароля и за действия под вашим аккаунтом. Указывайте достоверный email: на него приходит сброс пароля.',
          ],
        },
        {
          title: 'Что делает сервис',
          paragraphs: [
            'Pushup Tracker помогает записывать тренировки, считать баллы и серии, соревноваться с друзьями, в группах и челленджах. Сервис не даёт медицинских рекомендаций и не заменяет врача или тренера: нагрузку подбирайте по самочувствию и подготовке, при сомнениях проконсультируйтесь с врачом.',
          ],
        },
        {
          title: 'Правила поведения',
          items: [
            'не выдавать чужие результаты за свои и не накручивать результаты намеренно, чтобы обмануть других участников;',
            'не оскорблять, не травить и не беспокоить других пользователей, не размещать в профиле, названиях групп и челленджей незаконное или оскорбительное содержимое;',
            'не пытаться получить доступ к чужим аккаунтам и данным, не нарушать работу сервиса;',
            'не использовать сервис для рассылки спама.',
          ],
          paragraphs: [
            'На пользователя можно пожаловаться и заблокировать его в приложении и на сайте. Мы рассматриваем жалобы и можем скрыть содержимое, ограничить или закрыть аккаунт, нарушающий правила.',
          ],
        },
        {
          title: 'Ваше содержимое',
          paragraphs: [
            'Тренировки, аватар и другие данные остаются вашими. Вы разрешаете сервису хранить их и показывать тем пользователям, которым они видны по настройкам сервиса (друзья, участники групп и челленджей), — только для работы сервиса.',
          ],
        },
        {
          title: 'Доступность и изменения',
          paragraphs: [
            'Сервис предоставляется «как есть», без гарантий бесперебойной работы. Мы можем менять и прекращать отдельные функции и обновлять эти условия; актуальная редакция всегда на этой странице.',
          ],
        },
        {
          title: 'Удаление аккаунта',
          paragraphs: ['Вы можете удалить аккаунт в любой момент — см. страницу «Удаление аккаунта». Мы можем закрыть аккаунт, нарушающий эти условия.'],
        },
        {
          title: 'Данные',
          paragraphs: ['Что мы делаем с вашими данными, описано в политике конфиденциальности.'],
        },
      ] as readonly LegalSection[],
    },
    support: {
      metaTitle: 'Поддержка — Pushup Tracker',
      title: 'Поддержка',
      intro: 'Если что-то не работает или есть вопрос по данным, напишите нам — отвечаем на письма по мере возможности.',
      contactTitle: 'Связаться с нами',
      contactText: 'Email: {email}. Укажите логин и коротко опишите проблему; пароль присылать не нужно.',
      faqTitle: 'Частые вопросы',
      faq: [
        {
          title: 'Я забыл пароль',
          paragraphs: ['На странице входа нажмите «Забыли пароль» и введите email — придёт ссылка для сброса. Если письма нет, проверьте «Спам» и напишите нам.'],
        },
        {
          title: 'Тренировка не отправилась или пропала',
          paragraphs: ['В приложении тренировки, записанные без сети, ждут в очереди и отправляются сами, когда появится связь; очередь видна на экране тренировок. Если запись не уходит, откройте её и проверьте причину, а затем напишите нам.'],
        },
        {
          title: 'Как работает связь с «Здоровьем» и Health Connect',
          paragraphs: ['Это необязательно и включается в профиле. Приложение записывает ваши тренировки в «Здоровье» и может импортировать бег, велосипед и греблю. Отключить доступ можно в настройках телефона.'],
        },
        {
          title: 'Как пожаловаться на пользователя или заблокировать его',
          paragraphs: ['Откройте профиль пользователя или его реакцию и выберите «Пожаловаться» или «Заблокировать». Заблокированных можно вернуть в профиле, в разделе заблокированных.'],
        },
        {
          title: 'Как удалить аккаунт и данные',
          paragraphs: ['Кнопка «Удалить профиль» есть в профиле; полное удаление данных с сервера — по письму. Все подробности — на странице удаления аккаунта.'],
        },
      ] as readonly LegalSection[],
      deletionLink: 'Как удалить аккаунт и данные',
    },
    deletion: {
      metaTitle: 'Удаление аккаунта — Pushup Tracker',
      title: 'Удаление аккаунта',
      intro: 'Вы можете удалить аккаунт Pushup Tracker и свои данные в любой момент. Есть два способа.',
      sections: [
        {
          title: 'Способ 1 — в профиле (сайт и приложение)',
          items: [
            'Войдите в аккаунт и откройте «Профиль».',
            'Внизу страницы нажмите «Удалить профиль» и подтвердите.',
            'Вход закрывается сразу, все ваши сессии завершаются, профиль и тренировки перестают быть видны другим пользователям.',
          ],
        },
        {
          title: 'Способ 2 — письмом',
          paragraphs: [
            'Напишите на {email} с адреса, указанного при регистрации, и укажите логин. Так можно удалить данные и без доступа к аккаунту, а также попросить полное удаление данных с сервера после удаления в профиле.',
          ],
        },
        {
          title: 'Что удаляется',
          items: [
            'аккаунт: логин, email, хеш пароля, пол, дата рождения, вес, аватар, настройки;',
            'все ваши тренировки, баллы, серии и достижения, программы тренировок;',
            'дружба, подписки, участие в группах и челленджах, ваши реакции;',
            'блокировки и жалобы, связанные с аккаунтом;',
            'подписки веб-пушей, токены устройств (APNs, FCM), привязка Telegram, уведомления.',
          ],
          paragraphs: [
            'Полное удаление с сервера мы выполняем в течение 30 дней после запроса и подтверждаем письмом. Резервные копии сервера, в которых могут остаться удалённые данные, хранятся не дольше 30 дней и затем удаляются.',
          ],
        },
        {
          title: 'Что остаётся',
          items: [
            'Записи, которые приложение сделало в «Здоровье» или Health Connect, остаются на телефоне: удалите их в приложении «Здоровье» или Health Connect.',
            'Данные на устройстве (очередь тренировок и настройки) удаляются при удалении аккаунта и выходе или вместе с приложением.',
            'Группы и челленджи, созданные другими пользователями, продолжают работать без вас.',
          ],
        },
        {
          title: 'Нужна помощь',
          paragraphs: ['Если что-то не получается, напишите на {email}.'],
        },
      ] as readonly LegalSection[],
    },
  },
  en: {
    placeholderOperator: '[OPERATOR NOT SET — set LEGAL_OPERATOR_NAME on the server]',
    placeholderEmail: '[EMAIL NOT SET — set LEGAL_CONTACT_EMAIL on the server]',
    navTitle: 'Legal and support',
    navPrivacy: 'Privacy policy',
    navTerms: 'Terms of use',
    navSupport: 'Support',
    navDeletion: 'Account deletion',
    profileHint: 'Privacy policy, terms of use, support and account deletion.',
    writeToUs: 'Write to {email}',
    terms: {
      metaTitle: 'Terms of Use — Pushup Tracker',
      title: 'Terms of Use',
      updated: 'Version of 18 October 2026',
      intro:
        'These terms describe how you may use the Pushup Tracker website and apps. By registering and using the service you agree to them.',
      sections: [
        {
          title: 'Who we are',
          paragraphs: ['The service is run by {operator}. Questions: {email}.'],
        },
        {
          title: 'Age and account',
          paragraphs: [
            'The service is intended for users aged 5 and over. Children under 14 use it with the consent of a parent or legal guardian.',
            'You are responsible for keeping your password safe and for what happens under your account. Give a real email: password resets are sent there.',
          ],
        },
        {
          title: 'What the service does',
          paragraphs: [
            'Pushup Tracker helps you log workouts, earn points and streaks, and compete with friends, in groups and in challenges. It gives no medical advice and does not replace a doctor or coach: choose your load by how you feel and your fitness, and consult a doctor if in doubt.',
          ],
        },
        {
          title: 'Rules of conduct',
          items: [
            'do not pass off other people\'s results as yours and do not inflate results on purpose to deceive other participants;',
            'do not insult, harass or bother other users, and do not put unlawful or offensive content in profiles, group names or challenge names;',
            'do not try to access other people\'s accounts or data, and do not disrupt the service;',
            'do not use the service to send spam.',
          ],
          paragraphs: [
            'You can report and block a user in the app and on the website. We review reports and may hide content, limit or close an account that breaks the rules.',
          ],
        },
        {
          title: 'Your content',
          paragraphs: [
            'Your workouts, avatar and other data remain yours. You allow the service to store them and show them to the users who can see them under the service\'s settings (friends, members of groups and challenges), solely to run the service.',
          ],
        },
        {
          title: 'Availability and changes',
          paragraphs: [
            'The service is provided "as is", with no guarantee of uninterrupted operation. We may change or stop individual features and update these terms; the current version is always on this page.',
          ],
        },
        {
          title: 'Account deletion',
          paragraphs: ['You can delete your account at any time; see the "Account deletion" page. We may close an account that breaks these terms.'],
        },
        {
          title: 'Data',
          paragraphs: ['What we do with your data is described in the privacy policy.'],
        },
      ] as readonly LegalSection[],
    },
    support: {
      metaTitle: 'Support — Pushup Tracker',
      title: 'Support',
      intro: 'If something does not work or you have a question about your data, write to us; we answer emails as soon as we can.',
      contactTitle: 'Contact us',
      contactText: 'Email: {email}. Include your username and describe the problem briefly; never send your password.',
      faqTitle: 'Frequently asked questions',
      faq: [
        {
          title: 'I forgot my password',
          paragraphs: ['On the sign-in page tap "Forgot password" and enter your email; a reset link is sent. If it does not arrive, check Spam and write to us.'],
        },
        {
          title: 'A workout did not send or disappeared',
          paragraphs: ['In the app, workouts logged offline wait in a queue and send by themselves when the connection returns; the queue is visible on the workout screen. If an entry does not go, open it to see the reason, then write to us.'],
        },
        {
          title: 'How the Apple Health and Health Connect link works',
          paragraphs: ['It is optional and is turned on in the profile. The app writes your workouts to Health and can import running, cycling and rowing. You can turn the access off in the phone settings.'],
        },
        {
          title: 'How to report or block a user',
          paragraphs: ['Open the user\'s profile or their reaction and choose "Report" or "Block". Blocked users can be restored in the profile, in the blocked users section.'],
        },
        {
          title: 'How to delete my account and data',
          paragraphs: ['The "Delete profile" button is in the profile; full removal of data from the server is by email. All details are on the account deletion page.'],
        },
      ] as readonly LegalSection[],
      deletionLink: 'How to delete your account and data',
    },
    deletion: {
      metaTitle: 'Account Deletion — Pushup Tracker',
      title: 'Account deletion',
      intro: 'You can delete your Pushup Tracker account and your data at any time. There are two ways.',
      sections: [
        {
          title: 'Way 1 — in the profile (website and app)',
          items: [
            'Sign in and open "Profile".',
            'At the bottom of the page tap "Delete profile" and confirm.',
            'Sign-in is closed immediately, all your sessions end, and your profile and workouts are no longer visible to other users.',
          ],
        },
        {
          title: 'Way 2 — by email',
          paragraphs: [
            'Write to {email} from the address you registered with and give your username. This lets you delete data without access to the account, and also ask for full removal from the server after deleting in the profile.',
          ],
        },
        {
          title: 'What is deleted',
          items: [
            'the account: username, email, password hash, gender, birth date, weight, avatar, settings;',
            'all your workouts, points, streaks and achievements, training programs;',
            'friendships, follows, group and challenge participation, your reactions;',
            'blocks and reports tied to the account;',
            'web-push subscriptions, device tokens (APNs, FCM), the Telegram link, notifications.',
          ],
          paragraphs: [
            'We complete full removal from the server within 30 days of the request and confirm by email. Server backups that may still hold deleted data are kept no longer than 30 days and then removed.',
          ],
        },
        {
          title: 'What stays',
          items: [
            'Records the app wrote to Apple Health or Health Connect stay on your phone: delete them in Apple Health or Health Connect.',
            'Data on the device (workout queue and settings) is removed when you delete the account and sign out, or with the app.',
            'Groups and challenges created by other users keep working without you.',
          ],
        },
        {
          title: 'Need help',
          paragraphs: ['If something does not work, write to {email}.'],
        },
      ] as readonly LegalSection[],
    },
  },
} as const;
