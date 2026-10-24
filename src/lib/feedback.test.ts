import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FEEDBACK_TYPE, FEEDBACK_MAX_LENGTH, FEEDBACK_TYPES, parseFeedbackInput, sendFeedbackEmail } from './feedback';
import { feedbackTypeMessages } from '../i18n/messages/features/feedback-types';

/**
 * G05 / G05.1: обратная связь с типом «Ошибка / Идея / Жалоба» уходит письмом на `FEEDBACK_TO`,
 * тип — в теме. Отправка проверяется через общий почтовый слой: Resend с тестовым ключом,
 * запрос к его API перехватывается — наружу ничего не уходит.
 */

const MAIL_ENV = ['FEEDBACK_TO', 'FEEDBACK_PROJECT_LABEL', 'APP_URL', 'MAIL_PROVIDER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'MAIL_FROM'];

type SentMail = { to: string[]; subject: string; text: string; html?: string; reply_to?: string };

async function withMailStub(env: Record<string, string>, run: (sent: SentMail[]) => Promise<void>) {
  const savedEnv = new Map(MAIL_ENV.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const sent: SentMail[] = [];
  for (const key of MAIL_ENV) delete process.env[key];
  Object.assign(process.env, env);
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    assert.equal(url, 'https://api.resend.com/emails');
    sent.push(JSON.parse(String(init?.body)) as SentMail);
    return new Response('{"id":"stub"}', { status: 200 });
  }) as typeof fetch;
  try {
    await run(sent);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const MAIL_ON = { FEEDBACK_TO: 'owner@example.test', RESEND_API_KEY: 'test-key', APP_URL: 'https://tracker.example.test', FEEDBACK_PROJECT_LABEL: 'PushUp Tracker' };
const AUTHOR = { username: 'ann', userEmail: 'ann@example.test', userId: 'u1' };

test('feedback type: bug, idea or complaint; missing means bug; anything else is refused', () => {
  assert.deepEqual(parseFeedbackInput({ message: ' текст ' }), { ok: true, message: 'текст', type: 'bug' });
  assert.deepEqual(parseFeedbackInput({ message: 'x', type: null }), { ok: true, message: 'x', type: 'bug' });
  for (const type of ['bug', 'idea', 'complaint'] as const) {
    assert.deepEqual(parseFeedbackInput({ message: 'x', type }), { ok: true, message: 'x', type });
  }
  for (const type of ['question', 'BUG', '', 1, {}]) {
    const result = parseFeedbackInput({ message: 'x', type });
    assert.equal(result.ok, false, `type ${JSON.stringify(type)} must be refused`);
    if (!result.ok) assert.equal(result.code, 'BAD_TYPE');
  }
});

test('the sheet offers exactly the server types, «Ошибка» first (the default)', () => {
  assert.deepEqual(Object.keys(feedbackTypeMessages.ru.types), [...FEEDBACK_TYPES]);
  assert.deepEqual(Object.keys(feedbackTypeMessages.en.types), [...FEEDBACK_TYPES]);
  assert.equal(FEEDBACK_TYPES[0], DEFAULT_FEEDBACK_TYPE);
  assert.deepEqual(Object.values(feedbackTypeMessages.ru.types), ['Ошибка', 'Идея', 'Жалоба']);
});

test('feedback message: not empty and not longer than the limit', () => {
  const empty = parseFeedbackInput({ message: '   ', type: 'idea' });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, 'EMPTY');
  const long = parseFeedbackInput({ message: 'a'.repeat(FEEDBACK_MAX_LENGTH + 1) });
  assert.equal(long.ok, false);
  if (!long.ok) assert.equal(long.code, 'TOO_LONG');
  assert.equal(parseFeedbackInput({ message: 'a'.repeat(FEEDBACK_MAX_LENGTH) }).ok, true);
  const notObject = parseFeedbackInput(null);
  assert.equal(notObject.ok, false);
  if (!notObject.ok) assert.equal(notObject.code, 'BAD_JSON');
});

test('feedback goes to FEEDBACK_TO with its type in the subject and Reply-To of the author', async () => {
  await withMailStub(MAIL_ON, async (sent) => {
    const cases = [
      ['bug', 'Ошибка'],
      ['idea', 'Идея'],
      ['complaint', 'Жалоба'],
    ] as const;
    for (const [type, label] of cases) {
      const result = await sendFeedbackEmail({ ...AUTHOR, message: 'Кнопка <не> работает', type });
      assert.equal(result.sent, true);
      const mail = sent.at(-1)!;
      assert.deepEqual(mail.to, ['owner@example.test']);
      assert.match(mail.subject, /^\[PushUp Tracker\] /);
      assert.ok(mail.subject.includes(label), `subject «${mail.subject}» names the type ${label}`);
      assert.ok(mail.subject.includes('tracker.example.test'));
      assert.ok(mail.text.includes(label) && mail.text.includes('Кнопка <не> работает'));
      assert.ok(mail.html?.includes('Кнопка &lt;не&gt; работает'));
      assert.equal(mail.reply_to, 'ann@example.test');
    }
    assert.equal(sent.length, 3);
  });
});

test('without FEEDBACK_TO nothing is sent', async () => {
  await withMailStub({ RESEND_API_KEY: 'test-key' }, async (sent) => {
    assert.deepEqual(await sendFeedbackEmail({ ...AUTHOR, message: 'x', type: 'idea' }), { sent: false });
    assert.equal(sent.length, 0);
  });
});
