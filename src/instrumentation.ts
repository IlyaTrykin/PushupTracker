/**
 * Next.js server start hook: runs the background scheduler (program reminders, cleanup, …)
 * in the Node.js server process. `SCHEDULER_DISABLED=1` turns it off (dev, scripts).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.SCHEDULER_DISABLED === '1') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  const { startScheduler } = await import('./lib/scheduler');
  startScheduler();
}
