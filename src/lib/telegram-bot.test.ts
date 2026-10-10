import test from 'node:test';
import assert from 'node:assert/strict';
import { TelegramApiError, callTelegramApi } from './telegram/api';
import { createTelegramBot, telegramUnlinkedNotification, type TelegramBotDeps } from './telegram/bot';
import { parseWorkoutMessage } from './telegram/parse';
import { telegramMessages } from '../i18n/messages/features/telegram';
import { isTelegramEnabled, readTelegramConfig } from './telegram/config';
import type { ReplyWorkout } from './telegram/replies';

// Made-up values: the tests never talk to Telegram.
const BASE_ENV = {
  TELEGRAM_BOT_TOKEN: '123:fake-token',
  TELEGRAM_BOT_USERNAME: 'FakeBot',
  TELEGRAM_WEBHOOK_SECRET: 'fake_secret_value_1234',
};

test('the bot is on only with token, username and webhook secret', () => {
  assert.equal(isTelegramEnabled(readTelegramConfig(BASE_ENV)), true);
  for (const key of Object.keys(BASE_ENV)) {
    assert.equal(isTelegramEnabled(readTelegramConfig({ ...BASE_ENV, [key]: '  ' })), false, key);
  }
});

test('TELEGRAM_API_BASE: https anywhere, http only on localhost; otherwise the bot is off', () => {
  const enabledWith = (apiBase: string) => isTelegramEnabled(readTelegramConfig({ ...BASE_ENV, TELEGRAM_API_BASE: apiBase }));
  assert.equal(enabledWith(''), true);
  assert.equal(enabledWith('https://tg-proxy.example.org'), true);
  assert.equal(enabledWith('http://127.0.0.1:8081'), true);
  assert.equal(enabledWith('http://localhost:8081/'), true);
  assert.equal(enabledWith('http://[::1]:8081'), true);
  assert.equal(enabledWith('http://tg-proxy.example.org'), false);
  assert.equal(enabledWith('http://127.0.0.1.evil.example'), false);
  assert.equal(enabledWith('ftp://localhost'), false);
  assert.equal(enabledWith('not a url'), false);
});

test('the API client never sends the token over plain http to a remote host', async () => {
  const realFetch = globalThis.fetch;
  const called: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    called.push(String(input));
    return new Response(JSON.stringify({ ok: true, result: true }), { status: 200 });
  }) as typeof fetch;
  try {
    const config = readTelegramConfig({ ...BASE_ENV, TELEGRAM_API_BASE: 'http://tg-proxy.example.org' });
    await assert.rejects(callTelegramApi('getMe', {}, { config }), TelegramApiError);
    assert.deepEqual(called, []);
    const local = readTelegramConfig({ ...BASE_ENV, TELEGRAM_API_BASE: 'http://127.0.0.1:9' });
    assert.equal(await callTelegramApi('getMe', {}, { config: local }), true);
    assert.equal(called.length, 1);
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ---------------------------------------------------------------------------
// handleTelegramUpdate with an in-memory database
// ---------------------------------------------------------------------------

type FakeUser = {
  id: string;
  username: string;
  language: string;
  timeZone: string;
  favoriteExercises: string[];
  dailyGoalPoints: number | null;
  chatId: string | null;
};

const NOW = new Date('2026-10-10T12:00:00Z');

function fakeBot(opts: { users: FakeUser[]; codes?: Record<string, { userId: string; expiresAt: Date }> }) {
  const users = new Map(opts.users.map((u) => [u.id, { ...u }]));
  const codes = new Map(Object.entries(opts.codes ?? {}));
  const workouts: Array<ReplyWorkout & { userId: string }> = [];
  const takenOver: string[] = [];
  const errors: string[] = [];
  const byChat = (chatId: string) => [...users.values()].find((u) => u.chatId === chatId) ?? null;
  const linked = (u: FakeUser | null) => (u ? { ...u } : null);

  const deps: TelegramBotDeps = {
    hitRateLimit: async () => ({ ok: true }),
    findUserByChat: async (chatId) => linked(byChat(chatId)),
    findLinkCode: async (code, now) => {
      const row = codes.get(code);
      if (!row || row.expiresAt <= now) return null;
      return { userId: row.userId, username: users.get(row.userId)!.username };
    },
    linkChat: async ({ code, userId, chatId, expectedOwnerId, now }) => {
      const row = codes.get(code);
      if (!row || row.expiresAt <= now || row.userId !== userId) return null;
      const owner = byChat(chatId);
      if (owner && owner.id !== userId && owner.id !== expectedOwnerId) return null;
      codes.delete(code);
      if (owner && owner.id !== userId) owner.chatId = null;
      const user = users.get(userId)!;
      const previousChatId = user.chatId;
      user.chatId = chatId;
      return { previousChatId };
    },
    unlinkChat: async (userId) => {
      users.get(userId)!.chatId = null;
    },
    loadTodayWorkouts: async (userId) => workouts.filter((w) => w.userId === userId),
    createWorkout: async (user, parsed) => {
      const workout = { userId: user.id, exerciseType: parsed.exerciseType, reps: parsed.value, loadKg: parsed.loadKg ?? null };
      workouts.push(workout);
      return workout;
    },
    notifyChatTakenOver: async (userId) => {
      takenOver.push(userId);
    },
    logError: (label) => {
      errors.push(label);
    },
    appUrl: () => 'http://localhost:3100',
  };
  return { bot: createTelegramBot(deps), deps, users, codes, takenOver, errors, workouts };
}

let messageId = 1;
function update(chatId: string, text: string) {
  return { message: { message_id: messageId++, text, chat: { id: Number(chatId), type: 'private' }, from: { language_code: 'ru' } } };
}

const user = (id: string, chatId: string | null, extra: Partial<FakeUser> = {}): FakeUser => ({
  id,
  username: id,
  language: 'ru',
  timeZone: 'Europe/Moscow',
  favoriteExercises: ['pushups'],
  dailyGoalPoints: null,
  chatId,
  ...extra,
});

test('/start with a code for a chat linked to another account asks to confirm and moves nothing', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot, users, codes, takenOver } = fakeBot({
    users: [user('alice', '100'), user('mallory', null)],
    codes: { CODE1: { userId: 'mallory', expiresAt: later } },
  });

  const reply = await bot.handleTelegramUpdate(update('100', '/start CODE1'), NOW);

  assert.equal(users.get('alice')!.chatId, '100');
  assert.equal(users.get('mallory')!.chatId, null);
  assert.ok(codes.has('CODE1'), 'the code is not spent by the question');
  assert.deepEqual(takenOver, []);
  assert.equal(reply?.chatId, '100');
  assert.match(reply!.text, /alice/);
  assert.match(reply!.text, /mallory/);
  assert.deepEqual(reply?.buttons, ['/start CODE1 confirm']);
});

test('after the confirmation the chat moves and the old account is told «Telegram отключён»', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot, users, takenOver } = fakeBot({
    users: [user('alice', '100'), user('bob', null)],
    codes: { CODE2: { userId: 'bob', expiresAt: later } },
  });

  const reply = await bot.handleTelegramUpdate(update('100', '/start CODE2 confirm'), NOW);

  assert.equal(users.get('alice')!.chatId, null);
  assert.equal(users.get('bob')!.chatId, '100');
  assert.deepEqual(takenOver, ['alice']);
  assert.match(reply!.text, /^Подключено, bob!/);
  assert.equal(reply?.notices, undefined);
});

test('linking a second chat to an account tells the old chat it is disconnected', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot, users, takenOver } = fakeBot({
    users: [user('bob', '200')],
    codes: { CODE3: { userId: 'bob', expiresAt: later } },
  });

  const reply = await bot.handleTelegramUpdate(update('300', '/start CODE3'), NOW);

  assert.equal(users.get('bob')!.chatId, '300');
  assert.deepEqual(takenOver, []);
  assert.match(reply!.text, /^Подключено, bob!/);
  assert.deepEqual(reply?.notices, [{ chatId: '200', text: 'Telegram отключён: аккаунт bob подключён к другому чату.' }]);
});

test('re-linking the same chat to its own account needs no confirmation; a stale code is refused', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const earlier = new Date(NOW.getTime() - 1);
  const { bot, users } = fakeBot({
    users: [user('bob', '200'), user('carol', null)],
    codes: { OWN: { userId: 'bob', expiresAt: later }, OLD: { userId: 'carol', expiresAt: earlier } },
  });

  const own = await bot.handleTelegramUpdate(update('200', '/start OWN'), NOW);
  assert.match(own!.text, /^Подключено, bob!/);
  assert.equal(own?.notices, undefined);

  const stale = await bot.handleTelegramUpdate(update('200', '/start OLD confirm'), NOW);
  assert.match(stale!.text, /^Ссылка устарела/);
  assert.equal(users.get('bob')!.chatId, '200');
  assert.equal(users.get('carol')!.chatId, null);
});

test('a recorded workout: «Записал: 30 отжиманий (+30 баллов)» and the daily goal from the shared day total', async () => {
  const { bot } = fakeBot({ users: [user('dan', '400', { dailyGoalPoints: 100 })] });
  await bot.handleTelegramUpdate(update('400', 'планка 60'), NOW);
  const reply = await bot.handleTelegramUpdate(update('400', '30'), NOW);
  assert.equal(reply?.text, 'Записал: 30 отжиманий (+30 баллов).\nЦель дня: 36/100');
});

test('an error while handling an update answers «Не получилось, попробуй ещё раз»', async () => {
  const { bot, deps, errors } = fakeBot({ users: [user('erin', '500')] });
  deps.createWorkout = async () => {
    throw new Error('database is down');
  };
  const reply = await bot.handleTelegramUpdate(update('500', '30'), NOW);
  assert.deepEqual(reply, { chatId: '500', text: 'Не получилось, попробуй ещё раз.' });
  assert.equal(errors.length, 1);

  deps.findUserByChat = async () => {
    throw new Error('database is down');
  };
  const early = await bot.handleTelegramUpdate(update('500', '/today'), NOW);
  assert.equal(early?.text, 'Не получилось, попробуй ещё раз.');
});

test('the confirmed reply and the «link expired» reply remove the one-time keyboard', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot } = fakeBot({
    users: [user('alice', '100'), user('bob', null)],
    codes: { CODE5: { userId: 'bob', expiresAt: later } },
  });
  const linked = await bot.handleTelegramUpdate(update('100', '/start CODE5 confirm'), NOW);
  assert.match(linked!.text, /^Подключено, bob!/);
  assert.equal(linked?.removeKeyboard, true);
  const stale = await bot.handleTelegramUpdate(update('100', '/start CODE5 confirm'), NOW);
  assert.match(stale!.text, /^Ссылка устарела/);
  assert.equal(stale?.removeKeyboard, true);
});

test('confirm without a code, or with a code that is no longer valid, is refused and moves nothing', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot, users, takenOver } = fakeBot({
    users: [user('alice', '100'), user('mallory', null)],
    codes: { NEW: { userId: 'mallory', expiresAt: later } },
  });
  for (const text of ['/start confirm', '/start OLD_CODE confirm', '/start confirm NEW']) {
    const reply = await bot.handleTelegramUpdate(update('100', text), NOW);
    assert.match(reply!.text, /^Ссылка устарела/, text);
  }
  assert.equal(users.get('alice')!.chatId, '100');
  assert.equal(users.get('mallory')!.chatId, null);
  assert.deepEqual(takenOver, []);
});

test('confirm is refused when the chat changed owner after the question (the code stays unspent)', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot, deps, users, codes } = fakeBot({
    users: [user('alice', '100'), user('carol', null), user('mallory', null)],
    codes: { CODE6: { userId: 'mallory', expiresAt: later } },
  });
  const findUserByChat = deps.findUserByChat;
  // The question saw alice; by the time of linking the chat already belongs to carol.
  deps.findUserByChat = async (chatId) => {
    const seen = await findUserByChat(chatId);
    users.get('alice')!.chatId = null;
    users.get('carol')!.chatId = '100';
    return seen;
  };
  const reply = await bot.handleTelegramUpdate(update('100', '/start CODE6 confirm'), NOW);
  assert.match(reply!.text, /^Ссылка устарела/);
  assert.equal(users.get('carol')!.chatId, '100');
  assert.equal(users.get('mallory')!.chatId, null);
  assert.ok(codes.has('CODE6'));
});

test('a failed «Telegram отключён» notice after linking is logged; the chat is still linked and notices go out', async () => {
  const later = new Date(NOW.getTime() + 60_000);
  const { bot, deps, users, errors } = fakeBot({
    users: [user('alice', '100'), user('bob', '200')],
    codes: { CODE7: { userId: 'bob', expiresAt: later } },
  });
  deps.notifyChatTakenOver = async () => {
    throw new Error('notifications table is locked');
  };
  const reply = await bot.handleTelegramUpdate(update('100', '/start CODE7 confirm'), NOW);
  assert.match(reply!.text, /^Подключено, bob!/);
  assert.deepEqual(reply?.notices, [{ chatId: '200', text: 'Telegram отключён: аккаунт bob подключён к другому чату.' }]);
  assert.equal(users.get('bob')!.chatId, '100');
  assert.equal(errors.length, 1);
});

test('«Telegram отключён» is its own in-app type, not tied to any notification setting', () => {
  assert.deepEqual(telegramUnlinkedNotification('u1', 'ru'), {
    userId: 'u1',
    type: 'telegram_unlinked',
    title: 'Telegram отключён',
    body: 'Чат Telegram подключён к другому аккаунту. Подключить снова можно в профиле.',
    link: '/profile',
  });
  assert.equal(telegramUnlinkedNotification('u1', 'en').title, 'Telegram disconnected');
});

test('every example in the «did not get that» reply is understood by the parser', () => {
  for (const locale of ['ru', 'en'] as const) {
    const examples = [...telegramMessages[locale].bot.unknown.matchAll(/[«“]([^»”]+)[»”]/g)].map((m) => m[1]);
    assert.ok(examples.length >= 4, locale);
    for (const example of examples) assert.ok(parseWorkoutMessage(example, ['pushups']), `${locale}: ${example}`);
  }
});
