import { registerJob } from '../index';
import { cleanupJob } from './cleanup';
import { programRemindersJob } from './program-reminders';
import { groupGoalJob } from './group-goal';
import { dailyGoalJob } from './daily-goal';

/** Every background job of the app. New jobs (daily goal, weekly league, …) register here. */
export function registerDefaultJobs(): void {
  registerJob(programRemindersJob);
  registerJob(cleanupJob);
  registerJob(groupGoalJob);
  registerJob(dailyGoalJob);
}
