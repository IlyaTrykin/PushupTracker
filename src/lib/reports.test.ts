import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRateLimitWindow, type RateLimitBucketState } from './rate-limit';
import {
  REPORT_LIMIT_PER_HOUR,
  REPORT_TEXT_MAX_LENGTH,
  buildReportEmail,
  parseReportStatus,
  sendReportEmail,
  submitReport,
  type ReportDeps,
  type ReportEmailData,
} from './reports';

type Stored = { id: string; reporterId: string; targetUserId: string; context: string; contextId: string | null; reason: string; text: string | null };

function deps(opts: { mailFails?: boolean; mailSent?: boolean } = {}) {
  const reports: Stored[] = [];
  const mails: ReportEmailData[] = [];
  const buckets = new Map<string, RateLimitBucketState>();
  let clock = Date.parse('2026-10-18T12:00:00.000Z');
  const users = new Map([
    ['ann', { id: 'ann', username: 'ann', deletedAt: null }],
    ['bob', { id: 'bob', username: 'bob', deletedAt: null }],
    ['cat', { id: 'cat', username: 'cat', deletedAt: null }],
    ['gone', { id: 'gone', username: 'gone', deletedAt: new Date('2026-01-01') }],
  ]);
  const d: ReportDeps = {
    db: {
      user: { findUnique: async ({ where }) => users.get(where.id) ?? null },
      group: { findUnique: async ({ where }) => (where.id === 'g1' ? { id: 'g1', name: 'Утренние отжимания' } : null) },
      workoutReaction: {
        findUnique: async ({ where }) => (where.id === 'r1' ? { id: 'r1', userId: 'bob', emoji: '💩' } : null),
      },
      userReport: {
        create: async ({ data }) => {
          const row = { id: `rep${reports.length + 1}`, ...data };
          reports.push(row);
          return { id: row.id, createdAt: new Date(clock) };
        },
      },
    },
    hitRateLimit: async (key, limit, windowSeconds) => {
      const decision = applyRateLimitWindow(buckets.get(key) ?? null, new Date(clock), limit, windowSeconds);
      buckets.set(key, decision.bucket);
      return { ok: decision.ok, retryAfterSeconds: decision.retryAfterSeconds };
    },
    sendReportEmail: async (data) => {
      if (opts.mailFails) throw new Error('smtp down');
      mails.push(data);
      return { sent: opts.mailSent ?? true };
    },
  };
  return { d, reports, mails, advance: (ms: number) => (clock += ms) };
}

const ANN = { id: 'ann', username: 'ann' };

test('a report from a profile is stored and mailed with who, whom, why and the text', async () => {
  const { d, reports, mails } = deps();
  const result = await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'abuse', text: '  пишет гадости  ' }, d);
  assert.deepEqual(result, { ok: true, id: 'rep1', emailed: true });
  assert.deepEqual(reports, [
    { id: 'rep1', reporterId: 'ann', targetUserId: 'bob', context: 'profile', contextId: null, reason: 'abuse', text: 'пишет гадости' },
  ]);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].reporter.username, 'ann');
  assert.equal(mails[0].target.username, 'bob');
  assert.equal(mails[0].reason, 'abuse');
  assert.equal(mails[0].text, 'пишет гадости');
});

test('a report in a group names the group; on a reaction names the emoji', async () => {
  const { d, reports, mails } = deps();
  assert.equal((await submitReport(ANN, { targetUserId: 'bob', context: 'group', contextId: 'g1', reason: 'spam' }, d)).ok, true);
  assert.equal((await submitReport(ANN, { targetUserId: 'bob', context: 'reaction', contextId: 'r1', reason: 'inappropriate' }, d)).ok, true);
  assert.equal(reports[0].contextId, 'g1');
  assert.equal(mails[0].contextLabel, 'Утренние отжимания');
  assert.equal(reports[1].contextId, 'r1');
  assert.equal(mails[1].contextLabel, '💩');
  assert.equal(reports[1].text, null);
});

test('bad input is refused before anything is stored', async () => {
  const { d, reports } = deps();
  const cases: Array<[unknown, number, string]> = [
    [null, 400, 'BAD_INPUT'],
    [{ targetUserId: 'bob', context: 'profile', reason: 'nonsense' }, 400, 'BAD_REASON'],
    [{ targetUserId: 'bob', context: 'chat', reason: 'spam' }, 400, 'BAD_CONTEXT'],
    [{ targetUserId: 'bob', context: 'group', reason: 'spam' }, 400, 'BAD_CONTEXT'],
    [{ targetUserId: 'bob', context: 'profile', reason: 'other', text: 'x'.repeat(REPORT_TEXT_MAX_LENGTH + 1) }, 400, 'TEXT_TOO_LONG'],
    [{ targetUserId: 'ann', context: 'profile', reason: 'spam' }, 400, 'REPORT_SELF'],
    [{ targetUserId: 'nobody', context: 'profile', reason: 'spam' }, 404, 'USER_NOT_FOUND'],
    [{ targetUserId: 'gone', context: 'profile', reason: 'spam' }, 404, 'USER_NOT_FOUND'],
    [{ targetUserId: 'bob', context: 'group', contextId: 'g404', reason: 'spam' }, 404, 'CONTEXT_NOT_FOUND'],
    // The reaction must be the reported person's own.
    [{ targetUserId: 'cat', context: 'reaction', contextId: 'r1', reason: 'spam' }, 404, 'CONTEXT_NOT_FOUND'],
    [{ targetUserId: 'bob', context: 'reaction', contextId: 'r404', reason: 'spam' }, 404, 'CONTEXT_NOT_FOUND'],
  ];
  for (const [body, status, code] of cases) {
    const result = await submitReport(ANN, body, d);
    assert.equal(result.ok, false, JSON.stringify(body));
    assert.equal(!result.ok && result.status, status, JSON.stringify(body));
    assert.equal(!result.ok && 'code' in result && result.code, code, JSON.stringify(body));
  }
  assert.equal(reports.length, 0);
});

test('a text of exactly the limit is accepted', async () => {
  const { d, reports } = deps();
  const text = 'я'.repeat(REPORT_TEXT_MAX_LENGTH);
  assert.equal((await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'other', text }, d)).ok, true);
  assert.equal(reports[0].text, text);
});

test('at most 10 reports an hour per reporter; the 11th gets 429 and is not stored', async () => {
  const { d, reports, advance } = deps();
  assert.equal(REPORT_LIMIT_PER_HOUR, 10);
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'spam' }, d)).ok, true);
  }
  const eleventh = await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'spam' }, d);
  assert.equal(eleventh.ok, false);
  assert.equal(!eleventh.ok && eleventh.status, 429);
  assert.equal(reports.length, 10);
  advance(60 * 60 * 1000);
  assert.equal((await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'spam' }, d)).ok, true);
});

test('the report is kept when the mail is not configured or fails', async () => {
  const off = deps({ mailSent: false });
  assert.deepEqual(await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'spam' }, off.d), { ok: true, id: 'rep1', emailed: false });
  assert.equal(off.reports.length, 1);

  const failing = deps({ mailFails: true });
  assert.deepEqual(await submitReport(ANN, { targetUserId: 'bob', context: 'profile', reason: 'spam' }, failing.d), { ok: true, id: 'rep1', emailed: false });
  assert.equal(failing.reports.length, 1);
});

test('the letter escapes user text in HTML and links to the admin page', () => {
  const email = buildReportEmail(
    {
      id: 'rep1',
      reporter: { id: 'ann', username: 'ann' },
      target: { id: 'bob', username: '<b>bob</b>' },
      context: 'group',
      contextLabel: 'G & co',
      reason: 'abuse',
      text: '<script>x</script>',
    },
    { label: 'PushUp Tracker', site: 'example.test', adminUrl: 'https://example.test/admin/reports' },
  );
  assert.match(email.subject, /PushUp Tracker/);
  assert.match(email.text, /<b>bob<\/b>/);
  assert.match(email.text, /https:\/\/example\.test\/admin\/reports/);
  assert.ok(!email.html.includes('<script>'));
  assert.ok(email.html.includes('&lt;script&gt;'));
  assert.ok(email.html.includes('G &amp; co'));
});

test('report status accepts only new and reviewed', () => {
  assert.equal(parseReportStatus('new'), 'new');
  assert.equal(parseReportStatus('reviewed'), 'reviewed');
  assert.equal(parseReportStatus('closed'), null);
  assert.equal(parseReportStatus(undefined), null);
});

test('G05.1: a report is mailed to FEEDBACK_TO; the subject says it is a report, the letter names the reason', async () => {
  // Общий почтовый слой с тестовым ключом Resend; запрос к его API перехватывается — наружу ничего не уходит.
  const keys = ['FEEDBACK_TO', 'FEEDBACK_PROJECT_LABEL', 'APP_URL', 'MAIL_PROVIDER', 'RESEND_API_KEY', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const savedEnv = new Map(keys.map((key) => [key, process.env[key]]));
  const savedFetch = globalThis.fetch;
  const sent: { url: string; body: { to: string[]; subject: string; text: string } }[] = [];
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, { FEEDBACK_TO: 'owner@example.test', RESEND_API_KEY: 'test-key', APP_URL: 'https://tracker.example.test', FEEDBACK_PROJECT_LABEL: 'PushUp Tracker' });
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(input instanceof Request ? input.url : input), body: JSON.parse(String(init?.body)) });
    return new Response('{"id":"stub"}', { status: 200 });
  }) as typeof fetch;
  try {
    const result = await sendReportEmail({
      id: 'rep1',
      reporter: { id: 'ann', username: 'ann' },
      target: { id: 'bob', username: 'bob' },
      context: 'profile',
      contextLabel: null,
      reason: 'cheating',
      text: null,
    });
    assert.equal(result.sent, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, 'https://api.resend.com/emails');
    assert.deepEqual(sent[0].body.to, ['owner@example.test']);
    assert.match(sent[0].body.subject, /^\[PushUp Tracker\] Жалоба/);
    assert.match(sent[0].body.text, /Причина: накрутка результатов/);
    assert.match(sent[0].body.text, /https:\/\/tracker\.example\.test\/admin\/reports/);

    delete process.env.FEEDBACK_TO;
    assert.deepEqual(await sendReportEmail({ id: 'rep2', reporter: { id: 'ann', username: 'ann' }, target: { id: 'bob', username: 'bob' }, context: 'profile', contextLabel: null, reason: 'spam', text: null }), { sent: false });
    assert.equal(sent.length, 1);
  } finally {
    globalThis.fetch = savedFetch;
    for (const [key, value] of savedEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
