import type { SchedulerJob } from '../index';

const DAY_MS = 24 * 60 * 60 * 1000;

export const NOTIFICATION_RETENTION_DAYS = 180;
export const DISPATCH_RETENTION_DAYS = 60;
export const RATE_LIMIT_RETENTION_DAYS = 1; // every rate-limit window is ≤ 24 h

export type CleanupCutoffs = {
  /** Sessions, password-reset tokens and Telegram link codes that expired before this instant. */
  expiredBefore: Date;
  rateLimitBefore: Date;
  notificationsBefore: Date;
  dispatchBefore: Date;
};

export function cleanupCutoffs(now: Date): CleanupCutoffs {
  const ago = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return {
    expiredBefore: new Date(now.getTime()),
    rateLimitBefore: ago(RATE_LIMIT_RETENTION_DAYS),
    notificationsBefore: ago(NOTIFICATION_RETENTION_DAYS),
    dispatchBefore: ago(DISPATCH_RETENTION_DAYS),
  };
}

/** Claimed once per UTC day, so the cleanup runs once a day whatever the tick count. */
export function cleanupDispatchKey(now: Date): string {
  return `cleanup:${now.toISOString().slice(0, 10)}`;
}

export type CleanupDeps = {
  claimDispatch(key: string): Promise<boolean>;
  deleteOlderThan(cutoffs: CleanupCutoffs): Promise<Record<string, number>>;
};

export function createCleanupJob(deps: CleanupDeps): SchedulerJob {
  return {
    name: 'cleanup',
    async run(now) {
      if (!(await deps.claimDispatch(cleanupDispatchKey(now)))) return;
      const deleted = await deps.deleteOlderThan(cleanupCutoffs(now));
      const summary = Object.entries(deleted).map(([table, count]) => `${table}=${count}`).join(' ');
      if (summary) console.log(`Scheduler cleanup: ${summary}`);
    },
  };
}

export const cleanupJob = createCleanupJob({
  claimDispatch: async (key) => (await import('@/lib/notify')).claimDispatch(key),
  deleteOlderThan: async (c) => {
    const { prisma } = await import('@/lib/prisma');
    const [sessions, resetTokens, telegramCodes, rateLimits, notifications, dispatches] = await Promise.all([
      prisma.session.deleteMany({ where: { expiresAt: { lt: c.expiredBefore } } }),
      prisma.passwordResetToken.deleteMany({ where: { expiresAt: { lt: c.expiredBefore } } }),
      prisma.telegramLinkCode.deleteMany({ where: { expiresAt: { lt: c.expiredBefore } } }),
      prisma.rateLimitBucket.deleteMany({ where: { windowStart: { lt: c.rateLimitBefore } } }),
      prisma.notification.deleteMany({ where: { createdAt: { lt: c.notificationsBefore } } }),
      prisma.notificationDispatch.deleteMany({ where: { createdAt: { lt: c.dispatchBefore } } }),
    ]);
    return {
      Session: sessions.count,
      PasswordResetToken: resetTokens.count,
      TelegramLinkCode: telegramCodes.count,
      RateLimitBucket: rateLimits.count,
      Notification: notifications.count,
      NotificationDispatch: dispatches.count,
    };
  },
});
