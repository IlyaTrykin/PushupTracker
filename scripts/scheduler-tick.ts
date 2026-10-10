/**
 * Runs one scheduler tick against a LOCAL database (debugging the jobs).
 *
 *   DATABASE_URL=postgresql://…@127.0.0.1:55432/… npx tsx scripts/scheduler-tick.ts [--now=2026-10-10T16:00:00Z] [--parallel=2]
 *
 * --parallel=N runs N ticks at once (the dedupe keys must let each notice through once).
 *
 * Safety: the script refuses to run unless DATABASE_URL points to localhost / 127.0.0.1, and it
 * blanks SMTP_*, RESEND_API_KEY, VAPID_* and TELEGRAM_* in its own process, so a tick against a
 * copy of the production database never mails, pushes or messages real people. Only the explicit
 * `--live-channels` flag keeps those variables (in-app rows are written either way).
 */

const LOCAL_DB_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const CHANNEL_ENV = /^(SMTP_|VAPID_|TELEGRAM_)/;
const CHANNEL_ENV_NAMES = [
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'SMTP_SECURE', 'SMTP_FROM',
  'RESEND_API_KEY',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  'TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET', 'TELEGRAM_API_BASE',
];

function arg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

/** Loads `.env` the way Prisma would (existing variables win), so the checks below see the real values. */
function loadDotEnv() {
  try {
    process.loadEnvFile('.env');
  } catch {
    // no .env — only the shell environment counts
  }
}

function databaseHost(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Empty strings (not deletions): dotenv / Prisma never overwrite a variable that is already set. */
function blankChannelEnv() {
  for (const name of Object.keys(process.env)) {
    if (CHANNEL_ENV.test(name)) process.env[name] = '';
  }
  for (const name of CHANNEL_ENV_NAMES) process.env[name] = '';
}

async function main() {
  loadDotEnv();

  const host = databaseHost(process.env.DATABASE_URL);
  if (!host || !LOCAL_DB_HOSTS.has(host)) {
    console.error(`Refusing to run: DATABASE_URL must point to localhost or 127.0.0.1 (got host: ${host ?? 'none'}).`);
    process.exitCode = 1;
    return;
  }

  const liveChannels = hasFlag('live-channels');
  if (liveChannels) {
    console.warn('--live-channels: email, push and Telegram are sent for real.');
  } else {
    blankChannelEnv();
  }

  const rawNow = arg('now');
  const now = rawNow ? new Date(rawNow) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`Invalid --now: ${rawNow}`);
  const parallel = Math.max(1, Math.min(10, Number(arg('parallel') || 1) || 1));

  // Imported only now: the modules read the (already blanked) environment.
  const { prisma } = await import('../src/lib/prisma');
  const { runSchedulerTick } = await import('../src/lib/scheduler');
  const { registerDefaultJobs } = await import('../src/lib/scheduler/jobs');

  try {
    registerDefaultJobs();
    console.log(`Scheduler tick at ${now.toISOString()} ×${parallel}${liveChannels ? '' : ' (channels off: in-app only)'}`);
    await Promise.all(Array.from({ length: parallel }, () => runSchedulerTick(now)));
    // Deliveries run in the background; give push/email a moment to finish before exit.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
