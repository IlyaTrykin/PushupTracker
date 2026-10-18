/**
 * Reports on users (R33): from the person's profile, a group (the group is named) or a reaction.
 * A report is stored (`UserReport`, read in `/admin/reports`), then mailed to `FEEDBACK_TO` through
 * the common mail layer; a missing or failing mail never loses the report. At most
 * `REPORT_LIMIT_PER_HOUR` reports an hour per reporter.
 *
 * `submitReport` takes its database, rate limit and mail as deps (the route passes `prisma`,
 * `hitRateLimit` and `sendReportEmail`).
 */

import { esc } from './notification-email';

export const REPORT_LIMIT_PER_HOUR = 10;
export const REPORT_TEXT_MAX_LENGTH = 500;
export const REPORT_REASONS = ['spam', 'abuse', 'inappropriate', 'cheating', 'other'] as const;
export const REPORT_CONTEXTS = ['profile', 'group', 'reaction'] as const;
export const REPORT_STATUSES = ['new', 'reviewed'] as const;

export type ReportReason = (typeof REPORT_REASONS)[number];
export type ReportContext = (typeof REPORT_CONTEXTS)[number];
export type ReportStatus = (typeof REPORT_STATUSES)[number];

const HOUR_SECONDS = 60 * 60;
const ID_MAX_LENGTH = 64;

export type ReportEmailData = {
  id: string;
  reporter: { id: string; username: string };
  target: { id: string; username: string };
  context: ReportContext;
  /** Group name for 'group', the emoji for 'reaction'. */
  contextLabel: string | null;
  reason: ReportReason;
  text: string | null;
};

/** The part of Prisma `submitReport` uses (`prisma` fits as is). */
export type ReportDb = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; username: true; deletedAt: true };
    }): Promise<{ id: string; username: string; deletedAt: Date | null } | null>;
  };
  group: {
    findUnique(args: { where: { id: string }; select: { id: true; name: true } }): Promise<{ id: string; name: string } | null>;
  };
  workoutReaction: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; userId: true; emoji: true };
    }): Promise<{ id: string; userId: string; emoji: string } | null>;
  };
  userReport: {
    create(args: {
      data: { reporterId: string; targetUserId: string; context: ReportContext; contextId: string | null; reason: ReportReason; text: string | null };
      select: { id: true; createdAt: true };
    }): Promise<{ id: string; createdAt: Date }>;
  };
};

export type ReportDeps = {
  db: ReportDb;
  hitRateLimit(key: string, limit: number, windowSeconds: number): Promise<{ ok: boolean; retryAfterSeconds: number }>;
  sendReportEmail(data: ReportEmailData): Promise<{ sent: boolean }>;
};

export type SubmitReportResult =
  | { ok: true; id: string; emailed: boolean }
  | { ok: false; status: 400 | 404; error: string; code: string }
  | { ok: false; status: 429; retryAfterSeconds: number };

function fail(status: 400 | 404, code: string, error: string): SubmitReportResult {
  return { ok: false, status, code, error };
}

function field(body: unknown, name: string): unknown {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>)[name] : undefined;
}

function idField(body: unknown, name: string): string | null {
  const value = field(body, name);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= ID_MAX_LENGTH ? trimmed : null;
}

function isOneOf<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (list as readonly string[]).includes(value);
}

export function parseReportStatus(value: unknown): ReportStatus | null {
  return isOneOf(REPORT_STATUSES, value) ? value : null;
}

/** `POST /api/reports { targetUserId, context, contextId?, reason, text? }` on behalf of `reporter`. */
export async function submitReport(
  reporter: { id: string; username: string },
  body: unknown,
  deps: ReportDeps,
): Promise<SubmitReportResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'BAD_INPUT', 'Некорректный запрос');

  const targetUserId = idField(body, 'targetUserId');
  if (!targetUserId) return fail(400, 'BAD_INPUT', 'Не указан пользователь');

  const reason = field(body, 'reason');
  if (!isOneOf(REPORT_REASONS, reason)) return fail(400, 'BAD_REASON', 'Выберите причину жалобы');

  const context = field(body, 'context');
  if (!isOneOf(REPORT_CONTEXTS, context)) return fail(400, 'BAD_CONTEXT', 'Некорректный источник жалобы');
  const contextId = context === 'profile' ? null : idField(body, 'contextId');
  if (context !== 'profile' && !contextId) return fail(400, 'BAD_CONTEXT', 'Не указана группа или реакция');

  const rawText = field(body, 'text');
  if (rawText !== undefined && rawText !== null && typeof rawText !== 'string') return fail(400, 'BAD_INPUT', 'Некорректный текст');
  const text = typeof rawText === 'string' ? rawText.trim() : '';
  if (text.length > REPORT_TEXT_MAX_LENGTH) {
    return fail(400, 'TEXT_TOO_LONG', `Текст жалобы — не длиннее ${REPORT_TEXT_MAX_LENGTH} символов`);
  }

  if (targetUserId === reporter.id) return fail(400, 'REPORT_SELF', 'Нельзя пожаловаться на себя');

  const target = await deps.db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, username: true, deletedAt: true },
  });
  if (!target || target.deletedAt) return fail(404, 'USER_NOT_FOUND', 'Пользователь не найден');

  let contextLabel: string | null = null;
  if (context === 'group' && contextId) {
    const group = await deps.db.group.findUnique({ where: { id: contextId }, select: { id: true, name: true } });
    if (!group) return fail(404, 'CONTEXT_NOT_FOUND', 'Группа не найдена');
    contextLabel = group.name;
  }
  if (context === 'reaction' && contextId) {
    const reaction = await deps.db.workoutReaction.findUnique({ where: { id: contextId }, select: { id: true, userId: true, emoji: true } });
    if (!reaction || reaction.userId !== target.id) return fail(404, 'CONTEXT_NOT_FOUND', 'Реакция не найдена');
    contextLabel = reaction.emoji;
  }

  const limit = await deps.hitRateLimit(`user-report:${reporter.id}`, REPORT_LIMIT_PER_HOUR, HOUR_SECONDS);
  if (!limit.ok) return { ok: false, status: 429, retryAfterSeconds: limit.retryAfterSeconds };

  const saved = await deps.db.userReport.create({
    data: { reporterId: reporter.id, targetUserId: target.id, context, contextId, reason, text: text || null },
    select: { id: true, createdAt: true },
  });

  let emailed = false;
  try {
    emailed = (
      await deps.sendReportEmail({
        id: saved.id,
        reporter: { id: reporter.id, username: reporter.username },
        target: { id: target.id, username: target.username },
        context,
        contextLabel,
        reason,
        text: text || null,
      })
    ).sent;
  } catch (error) {
    // The report is stored and visible in the admin page; the letter is only a heads-up.
    console.error('USER REPORT MAIL ERROR:', error);
  }

  return { ok: true, id: saved.id, emailed };
}

const REASON_LABELS: Record<ReportReason, string> = {
  spam: 'спам',
  abuse: 'оскорбления или травля',
  inappropriate: 'неприемлемый контент',
  cheating: 'накрутка результатов',
  other: 'другое',
};

const CONTEXT_LABELS: Record<ReportContext, string> = {
  profile: 'профиль',
  group: 'группа',
  reaction: 'реакция',
};

/** The letter to the admin; user-written parts are escaped in HTML. */
export function buildReportEmail(
  data: ReportEmailData,
  opts: { label: string; site: string; adminUrl: string | null },
): { subject: string; text: string; html: string } {
  const where = data.contextLabel ? `${CONTEXT_LABELS[data.context]} «${data.contextLabel}»` : CONTEXT_LABELS[data.context];
  const lines = [
    `Новая жалоба на пользователя · ${opts.label} (${opts.site}).`,
    '',
    `На кого: ${data.target.username} (ID ${data.target.id})`,
    `От кого: ${data.reporter.username} (ID ${data.reporter.id})`,
    `Где: ${where}`,
    `Причина: ${REASON_LABELS[data.reason]}`,
    `ID жалобы: ${data.id}`,
  ];
  if (data.text) lines.push('', 'Текст:', data.text);
  if (opts.adminUrl) lines.push('', `Разобрать: ${opts.adminUrl}`);

  const html = [
    `<p>Новая жалоба на пользователя · <b>${esc(opts.label)}</b> (${esc(opts.site)}).</p>`,
    `<p>На кого: <b>${esc(data.target.username)}</b> (ID ${esc(data.target.id)})<br/>`,
    `От кого: <b>${esc(data.reporter.username)}</b> (ID ${esc(data.reporter.id)})<br/>`,
    `Где: ${esc(where)}<br/>`,
    `Причина: ${esc(REASON_LABELS[data.reason])}<br/>`,
    `ID жалобы: ${esc(data.id)}</p>`,
    data.text ? `<p>Текст:</p><p style="white-space:pre-wrap">${esc(data.text)}</p>` : '',
    opts.adminUrl ? `<p><a href="${esc(opts.adminUrl)}">Разобрать в админке</a></p>` : '',
  ].join('');

  return { subject: `[${opts.label}] Жалоба на пользователя · ${opts.site}`, text: lines.join('\n'), html };
}

/**
 * Mails the report to `FEEDBACK_TO` through the common mail layer. Without the address or a mail
 * provider (local development) nothing is sent and `{ sent: false }` comes back.
 */
export async function sendReportEmail(data: ReportEmailData, request?: Request): Promise<{ sent: boolean }> {
  const to = process.env.FEEDBACK_TO?.trim();
  if (!to) {
    console.warn('[report] FEEDBACK_TO is not set — report email skipped');
    return { sent: false };
  }
  const [{ sendMail }, { getFeedbackProjectLabel }, { getAppBaseUrl }] = await Promise.all([
    import('./mail'),
    import('./feedback'),
    import('./password-reset'),
  ]);
  const base = getAppBaseUrl(request).replace(/\/+$/, '');
  const email = buildReportEmail(data, {
    label: getFeedbackProjectLabel(),
    site: base.replace(/^https?:\/\//, ''),
    adminUrl: `${base}/admin/reports`,
  });
  return sendMail({ to, ...email }, { prefer: 'resend' });
}
