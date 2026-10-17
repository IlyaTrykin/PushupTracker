/**
 * How a tracker workout looks in Apple Health / Health Connect (interfaces.md §6).
 * Pure functions: the `HealthBridge` plugin gets a ready `HealthWorkoutInput` and only writes it.
 *
 * - Type: the table below; Apple Health gets `HKWorkoutActivityType` case names, Health Connect —
 *   `ExerciseSessionRecord.EXERCISE_TYPE_*` constant names (the plugin maps the name to the value).
 * - Time: the workout ends at its `time`; it starts `estimateDurationSeconds` earlier.
 * - Distance (run/bike/row): metres, as stored in `Workout.reps`. Reps go along for rep exercises
 *   (HK metadata `pushup.reps`, HC — in the title).
 */

import { exerciseLabel, getExercise } from '@/lib/exercises';
import { formatWorkoutValueParts } from '@/lib/exercise-metrics';
import { workoutFingerprint } from './reconcile';

export type HealthPlatform = 'apple_health' | 'health_connect';

export type HealthWorkoutInput = {
  /** `clientRequestId` of the workout (`wid:<id>` for an old workout without one). */
  externalId: string;
  exerciseType: string;
  /** Health type: HK `HKWorkoutActivityType` case name or HC `EXERCISE_TYPE_*` name. */
  activity: string;
  start: string;
  end: string;
  distanceMeters?: number;
  reps?: number;
  title: string;
  /** `workoutFingerprint` of the workout: a changed workout no longer matches its record. */
  fingerprint: string;
};

export type HealthWorkoutSource = {
  clientRequestId: string;
  exerciseType: string;
  reps: number;
  durationSeconds?: number | null;
  time: string;
};

type ActivityPair = { apple: string; android: string };

const STRENGTH: ActivityPair = { apple: 'functionalStrengthTraining', android: 'EXERCISE_TYPE_CALISTHENICS' };
const CORE: ActivityPair = { apple: 'coreTraining', android: 'EXERCISE_TYPE_CALISTHENICS' };
const KETTLEBELL: ActivityPair = { apple: 'traditionalStrengthTraining', android: 'EXERCISE_TYPE_STRENGTH_TRAINING' };

const ACTIVITY_BY_EXERCISE: Record<string, ActivityPair> = {
  run: { apple: 'running', android: 'EXERCISE_TYPE_RUNNING' },
  bike: { apple: 'cycling', android: 'EXERCISE_TYPE_BIKING' },
  row: { apple: 'rowing', android: 'EXERCISE_TYPE_ROWING_MACHINE' },
  plank: CORE,
  wall_sit: CORE,
  jump_rope: { apple: 'jumpRope', android: 'EXERCISE_TYPE_OTHER_WORKOUT' },
  kettlebell_press: KETTLEBELL,
  kettlebell_jerk: KETTLEBELL,
  kettlebell_swing: KETTLEBELL,
};

/** Seconds per metre when a distance workout has no duration: 6:00/km, 25 km/h, 2:30/500 m. */
const SECONDS_PER_METER: Record<string, number> = { run: 0.36, bike: 0.144, row: 0.3 };

const MIN_ESTIMATED_SECONDS = 60;
const SECONDS_PER_REP = 3;

function activityFor(exerciseType: string, platform: HealthPlatform): string {
  const pair = ACTIVITY_BY_EXERCISE[exerciseType] ?? STRENGTH;
  return platform === 'apple_health' ? pair.apple : pair.android;
}

/**
 * Length of the record in Health: the workout's own duration; a timed exercise lasts its value;
 * distance without a duration — at a typical pace; reps — 3 s each, at least a minute.
 */
export function estimateDurationSeconds(exerciseType: string, reps: number, durationSeconds?: number | null): number {
  if (durationSeconds != null && durationSeconds > 0) return Math.round(durationSeconds);
  const value = Math.max(0, Number(reps) || 0);
  const exercise = getExercise(exerciseType);
  if (exercise.id === exerciseType && exercise.unit === 'seconds') return Math.max(1, Math.round(value));
  const perMeter = SECONDS_PER_METER[exerciseType];
  if (perMeter) return Math.max(MIN_ESTIMATED_SECONDS, Math.round(value * perMeter));
  return Math.max(MIN_ESTIMATED_SECONDS, Math.round(value * SECONDS_PER_REP));
}

function titleFor(w: HealthWorkoutSource, locale: 'ru' | 'en'): string {
  const label = exerciseLabel(w.exerciseType, locale);
  const { main, detail } = formatWorkoutValueParts(
    { reps: w.reps, exerciseType: w.exerciseType, durationSeconds: w.durationSeconds ?? null },
    locale,
    false,
  );
  const unit = getExercise(w.exerciseType).unit;
  const value = unit === 'reps' ? `${main} ${locale === 'en' ? 'reps' : 'повт.'}` : main;
  return detail ? `${label} · ${value} · ${detail}` : `${label} · ${value}`;
}

export function toHealthWorkout(w: HealthWorkoutSource, platform: HealthPlatform, locale: 'ru' | 'en'): HealthWorkoutInput {
  const endMs = new Date(w.time).getTime();
  const seconds = estimateDurationSeconds(w.exerciseType, w.reps, w.durationSeconds);
  const unit = getExercise(w.exerciseType).unit;
  const input: HealthWorkoutInput = {
    externalId: w.clientRequestId,
    exerciseType: w.exerciseType,
    activity: activityFor(w.exerciseType, platform),
    start: new Date(endMs - seconds * 1000).toISOString(),
    end: new Date(endMs).toISOString(),
    title: titleFor(w, locale),
    fingerprint: workoutFingerprint(w),
  };
  if (unit === 'distance') input.distanceMeters = w.reps;
  if (unit === 'reps') input.reps = w.reps;
  return input;
}
