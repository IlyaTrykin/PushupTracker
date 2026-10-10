/**
 * Runs one scheduler tick against the database in DATABASE_URL (local debugging).
 *
 *   SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= \
 *   DATABASE_URL=postgresql://… npx tsx scripts/scheduler-tick.ts [--now=2026-10-10T16:00:00Z] [--parallel=2]
 *
 * --parallel=N runs N ticks at once (the dedupe keys must let each notice through once).
 * Empty SMTP_* / RESEND_API_KEY keep letters from leaving a dev machine.
 */
import { prisma } from '../src/lib/prisma';
import { runSchedulerTick } from '../src/lib/scheduler';
import { registerDefaultJobs } from '../src/lib/scheduler/jobs';

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

async function main() {
  const rawNow = arg('now');
  const now = rawNow ? new Date(rawNow) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now: ${rawNow}`);
  const parallel = Math.max(1, Math.min(10, Number(arg('parallel') || 1) || 1));

  registerDefaultJobs();
  console.log(`Scheduler tick at ${now.toISOString()} ×${parallel}`);
  await Promise.all(Array.from({ length: parallel }, () => runSchedulerTick(now)));
  // Deliveries run in the background; give push/email a moment to finish before exit.
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
