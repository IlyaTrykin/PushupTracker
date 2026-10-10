/**
 * Next.js server start hook: runs the background scheduler (program reminders, cleanup, …)
 * in the Node.js server process — only where `SCHEDULER_ENABLED=1` is set explicitly.
 * The flag lives only in `docker-compose.prod.yml` (service `web`): `next dev`, a local
 * `next start` or a local docker run against a copy of the production database never send
 * reminders to real people.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SCHEDULER_ENABLED !== '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { startScheduler } = await import('./lib/scheduler');
  startScheduler();
}
