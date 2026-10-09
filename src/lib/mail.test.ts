import test from 'node:test';
import assert from 'node:assert/strict';
import nodemailer from 'nodemailer';
import { buildMailMessage } from './mail';

test('a message built for SMTP is accepted and composed by nodemailer', async () => {
  const previousFrom = process.env.MAIL_FROM;
  process.env.MAIL_FROM = 'PushupTracker <noreply@example.test>';
  try {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
    const info = await transport.sendMail(
      buildMailMessage({
        to: 'ivan@example.test',
        subject: 'Сброс пароля',
        text: 'Ссылка для сброса',
        html: '<p>Ссылка для сброса</p>',
        replyTo: 'author@example.test',
      }),
    );

    assert.deepEqual(info.envelope, { from: 'noreply@example.test', to: ['ivan@example.test'] });
    const raw = String(info.message);
    assert.match(raw, /^From: PushupTracker <noreply@example\.test>$/m);
    assert.match(raw, /^To: ivan@example\.test$/m);
    assert.match(raw, /^Reply-To: author@example\.test$/m);
    assert.match(raw, /^Subject: =\?UTF-8\?/m);
    assert.match(raw, /multipart\/alternative/);
  } finally {
    if (previousFrom === undefined) delete process.env.MAIL_FROM;
    else process.env.MAIL_FROM = previousFrom;
  }
});

test('optional fields are left out of the message', async () => {
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: 'unix' });
  const info = await transport.sendMail(buildMailMessage({ to: 'ivan@example.test', subject: 'Hi', text: 'Hello' }));
  const raw = String(info.message);
  assert.deepEqual(info.envelope.to, ['ivan@example.test']);
  assert.doesNotMatch(raw, /^Reply-To:/m);
  assert.match(raw, /^Content-Type: text\/plain/m);
  assert.match(raw, /^Hello$/m);
});
