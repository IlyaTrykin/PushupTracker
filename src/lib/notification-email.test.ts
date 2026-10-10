import test from 'node:test';
import assert from 'node:assert/strict';
import type { SendMailInput } from './mail';
import { sendAdminNewUserRegisteredEmail, sendNotificationEmail } from './notification-email';

async function withEnv<T>(patch: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const env = process.env as Record<string, string | undefined>;
  const previous = Object.fromEntries(Object.keys(patch).map((k) => [k, env[k]]));
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(previous)) {
      if (v === undefined) delete env[k];
      else env[k] = v;
    }
  }
}

function capture() {
  const letters: SendMailInput[] = [];
  const send = async (input: SendMailInput) => {
    letters.push(input);
    return { sent: true };
  };
  return { letters, send };
}

// Real mail providers are switched off: letters only reach the captured `send`.
const noAppUrl = {
  NODE_ENV: 'production',
  APP_URL: undefined,
  NEXT_PUBLIC_APP_URL: undefined,
  SMTP_HOST: undefined,
  RESEND_API_KEY: undefined,
};
const message = { title: 'Друг потренировался', body: '30 отжиманий', link: '/friends' };

test('in production without APP_URL a notification letter goes out without a link', async () => {
  const { letters, send } = capture();
  await withEnv(noAppUrl, () => sendNotificationEmail('a@example.com', message, 'ru', send));
  assert.equal(letters.length, 1);
  const [letter] = letters;
  assert.match(letter.text ?? '', /Друг потренировался/);
  assert.match(letter.text ?? '', /30 отжиманий/);
  for (const part of [letter.text ?? '', letter.html ?? '']) {
    assert.doesNotMatch(part, /localhost|https?:\/\//, part);
    assert.doesNotMatch(part, /Открыть в приложении/, part);
  }
});

test('with APP_URL the letter links into the app', async () => {
  const { letters, send } = capture();
  await withEnv({ ...noAppUrl, APP_URL: 'https://app.example/' }, () =>
    sendNotificationEmail('a@example.com', message, 'en', send),
  );
  assert.match(letters[0].text ?? '', /Open in PushUp: https:\/\/app\.example\/friends/);
});

test('in production without APP_URL the request Host never becomes a link', async () => {
  const { letters, send } = capture();
  await withEnv(noAppUrl, () =>
    sendAdminNewUserRegisteredEmail(
      {
        to: 'admin@example.com',
        adminUsername: 'admin',
        newUsername: 'newbie',
        newEmail: 'newbie@example.com',
        request: new Request('https://evil.example/api/register'),
      },
      send,
    ),
  );
  assert.equal(letters.length, 1);
  assert.match(letters[0].text ?? '', /newbie/);
  assert.doesNotMatch(`${letters[0].text}${letters[0].html}`, /evil\.example|localhost/);
});
