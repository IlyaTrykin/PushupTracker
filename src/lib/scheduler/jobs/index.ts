import { registerJob } from '../index';
import { cleanupJob } from './cleanup';
import { programRemindersJob } from './program-reminders';
import { groupGoalJob } from './group-goal';
import { dailyGoalJob } from './daily-goal';
import { weeklyLeagueJob } from './weekly-league';
import { weeklySummaryJob } from './weekly-summary';

/** Every background job of the app. New jobs (daily goal, weekly league, …) register here. */
export function registerDefaultJobs(): void {
  registerJob(programRemindersJob);
  registerJob(cleanupJob);
  registerJob(groupGoalJob);
  registerJob(dailyGoalJob);
  registerJob(weeklyLeagueJob);
  registerJob(weeklySummaryJob);
}
