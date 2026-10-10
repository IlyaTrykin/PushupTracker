import { registerJob } from '../index';
import { cleanupJob } from './cleanup';
import { programRemindersJob } from './program-reminders';

/** Every background job of the app. New jobs (daily goal, weekly league, …) register here. */
export function registerDefaultJobs(): void {
  registerJob(programRemindersJob);
  registerJob(cleanupJob);
}
