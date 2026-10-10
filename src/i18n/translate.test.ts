import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from './translate';

const CYRILLIC = /[А-Яа-яЁё]/;

function assertEnglish(input: string) {
  const out = t('en', input);
  assert.doesNotMatch(out, CYRILLIC, `not translated: «${input}» → «${out}»`);
  return out;
}

test('fragments are replaced only as whole words: «Все…» never becomes «Sunе…»', () => {
  assert.doesNotMatch(t('en', 'Все системные события, приглашения и обновления собраны в одном потоке.'), /Sun/);
  // not in any dictionary — only the fragment rules apply
  assert.equal(t('en', 'Всем привет, Вс'), 'Всем привет, Sun');
  assert.equal(t('en', 'Пн–Вт'), 'Mon–Tue');
  assert.equal(t('en', 'Секундомер: 30 сек'), 'Секундомер: 30 sec');
  assert.equal(t('en', 'Средний темп'), 'Средний темп');
});

test('Russian locale returns the input unchanged', () => {
  assert.equal(t('ru', 'Уведомления'), 'Уведомления');
});

test('B25: the 12 page strings that stayed Russian in English are translated', () => {
  const strings = [
    'Безопасность',
    'Задай новый пароль и мы сразу вернём тебя ко входу.',
    'Восстановление доступа',
    'Центр уведомлений',
    'Уведомления',
    'Все системные события, приглашения и обновления собраны в одном потоке.',
    'Новое',
    'Соревновательный режим',
    'Челленджи',
    'Запускай соревнования, управляй приглашениями и отслеживай завершённые дуэли в одном месте.',
    'Ожидает подтверждения',
    'Пользователи и поощрения',
  ];
  for (const s of strings) assertEnglish(s);
  assert.equal(t('en', 'Уведомления'), 'Notifications');
});

test('server texts added by the account and social fixes have English versions', () => {
  assert.equal(t('en', 'Не в друзьях: alice, bob'), 'Not your friends: alice, bob');
  assert.equal(t('en', 'Заявку отклонили. Повторить можно через 3 дн.'), 'Your request was declined. You can try again in 3 days.');
  assert.equal(
    t('en', 'Пользователь отклонил вашу заявку. Повторить можно через 1 дн.'),
    'The user declined your request. You can try again in 1 day.',
  );
  assert.equal(t('en', 'Слишком много попыток, попробуйте через 15 мин'), 'Too many attempts, try again in 15 min');
  assert.equal(t('en', 'bob принял приглашение в соревнование: October'), 'bob accepted the challenge invitation: October');
  assert.equal(t('en', 'bob отклонил приглашение в соревнование: October'), 'bob declined the challenge invitation: October');
  assert.equal(t('en', 'bob принял ваш запрос в друзья'), 'bob accepted your friend request');
  assert.equal(t('en', 'bob отправил вам запрос в друзья'), 'bob sent you a friend request');
  assert.equal(t('en', 'Пароль (≥8)'), 'Password (≥8)');

  for (const s of [
    'Пригласить можно только друзей',
    'В соревновании может быть не больше 50 участников',
    'Название соревнования — не длиннее 80 символов',
    'Заявка уже отправлена и ожидает подтверждения',
    'Вы уже ответили на это приглашение',
    'В соревнованиях группы участие подтверждается автоматически',
    'Адрес push-подписки не поддерживается',
    'Конфликт одновременных изменений, повторите',
    'Запрос с чужого сайта отклонён',
    'Неподдерживаемый формат запроса',
    'Слишком большой запрос',
    'Ссылка недействительна или устарела',
    'Пароль должен быть не меньше 8 символов',
    'Ник или email уже заняты',
    'Восстановление пароля временно недоступно. Напишите администратору.',
    'Файл не является изображением JPEG, PNG, WebP или GIF',
    'Файл слишком большой (макс. 5 МБ)',
    'Вы вступили в группу Runners',
    'Вступление в группу Runners отклонено',
    'bob хочет вступить в группу Runners',
    'Новый запрос в друзья',
    'Новая реакция на тренировку',
  ]) {
    assertEnglish(s);
  }
});

test('program notifications stored in Russian are shown in English with the catalog exercise name', () => {
  assert.equal(
    t('en', 'Прошёл 1 час после плановой тренировки (отжимания). Вы можете выполнить её сейчас.'),
    'An hour has passed since your planned workout (push-ups). You can still do it now.',
  );
  assert.equal(t('en', 'Через 10 мин: тренировка pullups'), 'Program workout in 10 min: pull-ups');
  assert.equal(t('en', 'Прошли сутки после плановой тренировки (приседания).'), 'A day has passed since your planned workout (squats).');
});
