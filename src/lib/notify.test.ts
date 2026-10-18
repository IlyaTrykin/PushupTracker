import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotifier, type NotifyDeps, type NotifyRecipient } from './notify';
import { resolveChannelPreference } from './notification-preferences';

type Sent = { channel: 'push' | 'email' | 'telegram'; to: string; title: string; body?: string; link?: string };

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`key`)'), { code: 'P2002' });
}

function recipient(id: string, overrides: Partial<NotifyRecipient> = {}): NotifyRecipient {
  return {
    id,
    locale: 'ru',
    email: `${id}@example.test`,
    telegramChatId: null,
    channels: { push: true, email: false, telegram: false },
    ...overrides,
  };
}

function fakeWorld(recipients: NotifyRecipient[], failing: Partial<Record<Sent['channel'], boolean>> = {}) {
  const dispatchKeys = new Set<string>();
  const inApp: Array<{ userId: string; type: string; title: string; body: string | null; link: string | null }> = [];
  const sent: Sent[] = [];
  const pending: Array<Promise<void>> = [];
  const errors: string[] = [];

  const deps: NotifyDeps = {
    insertDispatch: async (key) => {
      if (dispatchKeys.has(key)) throw uniqueViolation();
      dispatchKeys.add(key);
    },
    loadRecipients: async (userIds) => recipients.filter((r) => userIds.includes(r.id)),
    createInApp: async (rows) => {
      inApp.push(...rows);
    },
    sendPush: async (userId, payload) => {
      if (failing.push) throw new Error('push service down');
      sent.push({ channel: 'push', to: userId, title: payload.title, body: payload.body, link: payload.link });
    },
    sendEmail: async (to, message) => {
      if (failing.email) throw new Error('smtp down');
      sent.push({ channel: 'email', to, ...message });
    },
    sendTelegram: async (chatId, message) => {
      if (failing.telegram) throw new Error('telegram down');
      sent.push({ channel: 'telegram', to: chatId, ...message });
    },
    defer: (task) => {
      pending.push(task());
    },
    logError: (label) => {
      errors.push(label);
    },
  };

  return {
    deps,
    inApp,
    sent,
    errors,
    settle: () => Promise.all(pending),
  };
}

const build = (locale: 'ru' | 'en') => (locale === 'en'
  ? { title: 'Workout soon', body: 'Push-ups at 19:00', link: '/program' }
  : { title: 'Скоро тренировка', body: 'Отжимания в 19:00', link: '/program' });

test('claimDispatch: the first claim of a key wins, a repeated key (P2002) is refused', async () => {
  const world = fakeWorld([]);
  const { claimDispatch } = createNotifier(world.deps);
  assert.equal(await claimDispatch('program-reminder:s1'), true);
  assert.equal(await claimDispatch('program-reminder:s1'), false);
  assert.equal(await claimDispatch('program-reminder:s2'), true);
});

test('claimDispatch: database errors other than P2002 are not swallowed', async () => {
  const world = fakeWorld([]);
  const notifier = createNotifier({
    ...world.deps,
    insertDispatch: async () => {
      throw new Error('connection refused');
    },
  });
  await assert.rejects(() => notifier.claimDispatch('k'), /connection refused/);
});

test('notifyUsers with the same dedupe key sends once even when two ticks run in parallel', async () => {
  const world = fakeWorld([recipient('u1')]);
  const { notifyUsers } = createNotifier(world.deps);
  const opts = { dedupeKey: (userId: string) => `daily-goal:${userId}:2026-10-10` };

  await Promise.all([
    notifyUsers(['u1'], 'daily_goal_reminder', build, opts),
    notifyUsers(['u1'], 'daily_goal_reminder', build, opts),
  ]);
  await world.settle();

  assert.equal(world.inApp.length, 1);
  assert.equal(world.sent.filter((s) => s.channel === 'push').length, 1);
});

test('notifyUsers sends each channel only where the recipient enabled it', async () => {
  const world = fakeWorld([
    recipient('push-only'),
    recipient('email-only', { channels: { push: false, email: true, telegram: false } }),
    recipient('everything', { telegramChatId: '777', channels: { push: true, email: true, telegram: true } }),
    recipient('telegram-unlinked', { telegramChatId: null, channels: { push: false, email: false, telegram: true } }),
    recipient('no-email-address', { email: null, channels: { push: false, email: true, telegram: false } }),
  ]);
  const { notifyUsers } = createNotifier(world.deps);

  await notifyUsers(
    ['push-only', 'email-only', 'everything', 'telegram-unlinked', 'no-email-address'],
    'weekly_summary',
    build,
  );
  await world.settle();

  const delivered = world.sent.map((s) => `${s.channel}:${s.to}`).sort();
  assert.deepEqual(delivered, [
    'email:email-only@example.test',
    'email:everything@example.test',
    'push:everything',
    'push:push-only',
    'telegram:777',
  ]);
  // in-app goes to everyone regardless of channel settings
  assert.equal(world.inApp.length, 5);
  assert.ok(world.inApp.every((row) => row.type === 'weekly_summary'));
});

test('notifyUsers builds the text in each recipient language', async () => {
  const world = fakeWorld([recipient('ru-user'), recipient('en-user', { locale: 'en' })]);
  const { notifyUsers } = createNotifier(world.deps);

  await notifyUsers(['ru-user', 'en-user'], 'program_reminder', build);
  await world.settle();

  const byUser = new Map(world.inApp.map((row) => [row.userId, row.title]));
  assert.equal(byUser.get('ru-user'), 'Скоро тренировка');
  assert.equal(byUser.get('en-user'), 'Workout soon');
  const push = world.sent.find((s) => s.channel === 'push' && s.to === 'en-user');
  assert.equal(push?.body, 'Push-ups at 19:00');
});

test('a failing channel does not stop the other channels nor reject the call', async () => {
  const world = fakeWorld(
    [recipient('u1', { telegramChatId: '42', channels: { push: true, email: true, telegram: true } })],
    { push: true },
  );
  const { notifyUsers } = createNotifier(world.deps);

  await notifyUsers(['u1'], 'friend_achievement', build);
  await world.settle();

  assert.deepEqual(world.sent.map((s) => s.channel).sort(), ['email', 'telegram']);
  assert.equal(world.inApp.length, 1);
  assert.ok(world.errors.length >= 1);
});

test('inApp: false skips the notification centre but still delivers push', async () => {
  const world = fakeWorld([recipient('u1')]);
  const { notifyUsers } = createNotifier(world.deps);

  await notifyUsers(['u1'], 'weekly_league', build, { inApp: false });
  await world.settle();

  assert.equal(world.inApp.length, 0);
  assert.equal(world.sent.length, 1);
});

test('channel preference: defaults apply without a row, a stored row wins, admin-only events skip non-admins', () => {
  const def = { eventType: 'friend_request' as const, label: 'x', defaultPush: true, defaultEmail: true, defaultTelegram: false };
  assert.deepEqual(resolveChannelPreference(def, null, false), { push: true, email: true, telegram: false });
  assert.deepEqual(
    resolveChannelPreference(def, { pushEnabled: false, emailEnabled: true, telegramEnabled: true }, false),
    { push: false, email: true, telegram: true },
  );
  assert.equal(resolveChannelPreference({ ...def, adminOnly: true }, null, false), null);
  assert.deepEqual(resolveChannelPreference({ ...def, adminOnly: true }, null, true), { push: true, email: true, telegram: false });
});

test('friend workout text: recipient language, catalog exercise name instead of the id, units', async () => {
  const { friendWorkoutMessage, challengeRankMessage } = await import('./notify');
  const en = friendWorkoutMessage('en', { username: 'bob', exerciseType: 'kettlebell_press', value: 10, loadKg: 16 });
  assert.equal(en.body, 'bob: Kettlebell press — 10 × 16 kg');
  assert.doesNotMatch(`${en.title} ${en.body}`, /kettlebell_press|[А-Яа-яЁё]/);
  const ru = friendWorkoutMessage('ru', { username: 'bob', exerciseType: 'plank', value: 60 });
  assert.equal(ru.body, 'bob: Планка — 60 сек');
  const rank = challengeRankMessage('en', { challengeId: 'c1', challengeName: 'October', previousRank: 3, rank: 2 });
  assert.equal(rank.body, 'October: 3 → 2 (moved up)');
  assert.equal(rank.link, '/challenges/c1');
});

test('inAppOnly writes the notification centre row and sends nothing else', async () => {
  const world = fakeWorld([recipient('u1', { telegramChatId: '1', channels: { push: true, email: true, telegram: true } })]);
  const { notifyUsers } = createNotifier(world.deps);

  await notifyUsers(['u1'], 'challenge_invite', build, { inAppOnly: true, type: 'challenge_accept' });
  await world.settle();

  assert.equal(world.inApp.length, 1);
  assert.equal(world.inApp[0].type, 'challenge_accept');
  assert.equal(world.sent.length, 0);
});

test('friend request: Telegram-enabled recipients get it in Telegram, each in their own language', async () => {
  const { friendRequestMessage } = await import('./notify');
  const world = fakeWorld([
    recipient('ru-user', { telegramChatId: '111', channels: { push: true, email: false, telegram: true } }),
    recipient('en-user', { locale: 'en', telegramChatId: '222', channels: { push: false, email: false, telegram: true } }),
    recipient('no-tg', { telegramChatId: '333', channels: { push: true, email: false, telegram: false } }),
  ]);
  const { notifyUsers } = createNotifier(world.deps);

  await notifyUsers(['ru-user', 'en-user', 'no-tg'], 'friend_request', (locale) => friendRequestMessage(locale, { username: 'bob' }), {
    tag: 'friend-request-f1',
  });
  await world.settle();

  const telegram = world.sent.filter((s) => s.channel === 'telegram');
  assert.deepEqual(telegram.map((s) => [s.to, s.title, s.body]), [
    ['111', 'Новый запрос в друзья', 'bob отправил вам запрос в друзья'],
    ['222', 'New friend request', 'bob sent you a friend request'],
  ]);
  assert.deepEqual(world.inApp.map((row) => [row.userId, row.type, row.link]), [
    ['ru-user', 'friend_request', '/friends'],
    ['en-user', 'friend_request', '/friends'],
    ['no-tg', 'friend_request', '/friends'],
  ]);
});

test('friends and groups texts: recipient language, exercise name and value instead of a bare number', async () => {
  const { friendRequestAcceptedMessage, friendReactionMessage, groupJoinRequestMessage, groupJoinResolvedMessage } = await import('./notify');

  assert.deepEqual(friendRequestAcceptedMessage('en', { username: 'ann' }), { title: 'Friend request accepted', body: 'ann accepted your friend request', link: '/friends' });
  assert.equal(friendRequestAcceptedMessage('ru', { username: 'ann' }).body, 'ann принял ваш запрос в друзья');

  const reaction = { username: 'ann', emoji: '🔥', workout: { exerciseType: 'plank', reps: 60 } };
  assert.equal(friendReactionMessage('ru', reaction).body, 'ann 🔥 на вашу тренировку: Планка — 60 сек');
  const en = friendReactionMessage('en', { ...reaction, workout: { exerciseType: 'run', reps: 5200, durationSeconds: 1590 } });
  assert.equal(en.title, 'New reaction to your workout');
  assert.equal(en.body, 'ann 🔥 on your workout: Running — 5.2 km · 26:30 (5:06/km)');

  const join = groupJoinRequestMessage('en', { username: 'ann', groupId: 'g1', groupName: 'Morning crew' });
  assert.deepEqual(join, { title: 'New request to join a group', body: 'ann wants to join Morning crew', link: '/groups/g1' });
  assert.equal(groupJoinRequestMessage('ru', { username: 'ann', groupId: 'g1', groupName: 'Утро' }).body, 'ann хочет вступить в группу Утро');

  assert.deepEqual(groupJoinResolvedMessage('en', { groupId: 'g1', groupName: 'Morning crew', approved: true }), { title: 'Join request approved', body: 'You joined Morning crew', link: '/groups/g1' });
  assert.equal(groupJoinResolvedMessage('en', { groupId: 'g1', groupName: 'Morning crew', approved: false }).body, 'Your request to join Morning crew was declined');
  assert.equal(groupJoinResolvedMessage('ru', { groupId: 'g1', groupName: 'Утро', approved: false }).title, 'Заявка в группу отклонена');

  for (const message of [friendRequestAcceptedMessage('en', { username: 'ann' }), en, join]) {
    assert.doesNotMatch(`${message.title} ${message.body}`, /[А-Яа-яЁё]/);
  }
});

test('push channel: the same payload goes to web push and to native push; one failing does not stop the other', async () => {
  const { createPushSender } = await import('./notify');
  const calls: Array<[string, string[], unknown]> = [];
  const errors: string[] = [];
  const sendPush = createPushSender({
    web: async (ids, payload) => {
      calls.push(['web', ids, payload]);
      throw new Error('VAPID service down');
    },
    native: async (ids, payload) => {
      calls.push(['native', ids, payload]);
    },
    logError: (label) => errors.push(label),
  });
  const payload = { title: 'Цель дня', body: 'Осталось 20', link: '/dashboard', tag: 'pushup-daily_goal_reminder' };
  await sendPush('u1', payload);
  assert.deepEqual(calls.sort((a, b) => a[0].localeCompare(b[0])), [['native', ['u1'], payload], ['web', ['u1'], payload]]);
  assert.deepEqual(errors, ['NOTIFY WEB PUSH ERROR']);
});

test('notifyUsers with push on and no APNs/FCM keys: web push still goes, native sends nothing and does not fail', async () => {
  const { createPushSender } = await import('./notify');
  const { sendNativePushToUsers } = await import('./native-push');
  const web: string[] = [];
  let devicesLookedUp = false;
  let nativeSent = 0;
  const sendPush = createPushSender({
    web: async (ids) => {
      web.push(...ids);
    },
    native: (ids, payload) => sendNativePushToUsers(ids, payload, undefined, {
      env: {},
      now: () => new Date(),
      findDevices: async () => {
        devicesLookedUp = true;
        return [{ id: 'd1', platform: 'ios', token: 'a'.repeat(64) }];
      },
      deactivate: async () => {},
      sendApns: async () => {
        nativeSent += 1;
        return { status: 200, body: '' };
      },
      sendFcm: async () => {
        nativeSent += 1;
        return { status: 200, body: '' };
      },
      logError: () => {},
    }).then(() => undefined),
    logError: () => {},
  });
  const { deps, settle, errors } = fakeWorld([recipient('u1')]);
  const { notifyUsers } = createNotifier({ ...deps, sendPush });
  await notifyUsers(['u1'], 'friend_request', () => ({ title: 'Hi', link: '/friends' }));
  await settle();
  assert.deepEqual(web, ['u1']);
  assert.equal(devicesLookedUp, false);
  assert.equal(nativeSent, 0);
  assert.deepEqual(errors, []);
});
