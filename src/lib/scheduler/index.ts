/**
 * In-process background scheduler (one Next.js instance): every 5 minutes runs each
 * registered job. Started from `src/instrumentation.ts`; `SCHEDULER_DISABLED=1` turns it off.
 * Jobs must be idempotent per tick — notifications claim keys via `claimDispatch`.
 */

export type SchedulerJob = { name: string; run(now: Date): Promise<void> };

export const SCHEDULER_TICK_MS = 5 * 60 * 1000;
export const SCHEDULER_FIRST_TICK_MS = 30 * 1000;

type SchedulerState = {
  jobs: SchedulerJob[];
  started: boolean;
  running: boolean;
};

// globalThis survives dev hot reloads, so the timer is never started twice.
const globalForScheduler = globalThis as unknown as { pushupScheduler?: SchedulerState };
const state: SchedulerState = globalForScheduler.pushupScheduler
  ?? (globalForScheduler.pushupScheduler = { jobs: [], started: false, running: false });

export function registerJob(job: SchedulerJob): void {
  const index = state.jobs.findIndex((j) => j.name === job.name);
  if (index >= 0) state.jobs[index] = job;
  else state.jobs.push(job);
}

/** Test helper: forget registered jobs. */
export function clearJobsForTest(): void {
  state.jobs.length = 0;
}

export async function runSchedulerTick(now: Date = new Date()): Promise<void> {
  for (const job of [...state.jobs]) {
    try {
      await job.run(now);
    } catch (error) {
      console.error(`SCHEDULER JOB ${job.name} ERROR:`, error instanceof Error ? error.message : String(error));
    }
  }
}

async function tick(): Promise<void> {
  // A slow tick is never overlapped by the next one in the same process.
  if (state.running) return;
  state.running = true;
  try {
    await runSchedulerTick(new Date());
  } finally {
    state.running = false;
  }
}

export function startScheduler(): void {
  if (state.started) return;
  state.started = true;

  void import('./jobs').then(({ registerDefaultJobs }) => {
    registerDefaultJobs();
    const first = setTimeout(() => void tick(), SCHEDULER_FIRST_TICK_MS);
    first.unref?.();
    const every = setInterval(() => void tick(), SCHEDULER_TICK_MS);
    every.unref?.();
    console.log(`Scheduler started: ${state.jobs.map((j) => j.name).join(', ')}`);
  }).catch((error) => {
    state.started = false;
    console.error('SCHEDULER START ERROR:', error instanceof Error ? error.message : String(error));
  });
}
