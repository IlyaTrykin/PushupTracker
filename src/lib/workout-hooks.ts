/**
 * What happens after a workout is created (any source: web, Telegram).
 * Records and achievements arrive with T11; until then the hook reports nothing.
 */

export type CreatedWorkout = {
  id: string;
  reps: number;
  loadKg: number | null;
  repsLeft: number | null;
  repsRight: number | null;
  date: Date;
  time: Date;
  exerciseType: string;
  trainingSessionId: string | null;
};

export type WorkoutHookUser = { id: string; username: string; timeZone: string };

export type WorkoutHookResult<R = unknown, A = unknown> = { records: R[]; achievements: A[] };

export async function onWorkoutCreated(workout: CreatedWorkout, user: WorkoutHookUser): Promise<WorkoutHookResult> {
  void workout;
  void user;
  return { records: [], achievements: [] };
}
