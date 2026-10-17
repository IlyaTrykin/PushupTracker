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

import { dayKeyInZone } from '@/lib/calendar-day';
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

// --- Import from Health ---

/** A cardio session read from Health (`HealthBridge.querySessions`). */
export type HealthSession = {
  /** HK workout UUID / HC record id. */
  id: string;
  platform: HealthPlatform;
  /** `run` | `bike` | `row` for what can be imported; anything else is shown as unsupported. */
  activity: 'run' | 'bike' | 'row' | string;
  start: string;
  end: string;
  distanceMeters: number | null;
  sourceName: string;
  /** Written by PushupTracker itself: never offered for import. */
  fromThisApp: boolean;
};

export type ImportReason = 'unsupported' | 'no_distance' | 'too_short' | 'too_long' | 'no_duration';

export type ImportWorkout = {
  exerciseType: 'run' | 'bike' | 'row';
  /** Metres. */
  reps: number;
  durationSeconds: number;
  date: string;
  time: string;
  clientRequestId: string;
};

export type ImportCandidate = { session: HealthSession; workout: ImportWorkout | null; reason: ImportReason | null };

const IMPORT_EXERCISES = new Set(['run', 'bike', 'row']);
/** Same bounds as `parseWorkoutLoadFields` for distance (workout-input.ts). */
const MIN_IMPORT_METERS = 10;
const MAX_IMPORT_METERS = 300_000;
const MAX_IMPORT_SECONDS = 48 * 3600;
const REQUEST_ID_MAX_LENGTH = 64;
const REQUEST_ID_BODY_RE = /^[A-Za-z0-9_.:-]+$/;

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

/** Synchronous SHA-256 (hex) of a string: the browser's `crypto.subtle` is async-only. */
function sha256Hex(text: string): string {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  const low = bitLength >>> 0;
  for (const word of [high, low]) for (let shift = 24; shift >= 0; shift -= 8) bytes.push((word >>> shift) & 0xff);

  const h = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const w = new Array<number>(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      const j = offset + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i += 1) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA256_K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      hh = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    h[0] = (h[0] + a) >>> 0;
    h[1] = (h[1] + b) >>> 0;
    h[2] = (h[2] + c) >>> 0;
    h[3] = (h[3] + d) >>> 0;
    h[4] = (h[4] + e) >>> 0;
    h[5] = (h[5] + f) >>> 0;
    h[6] = (h[6] + g) >>> 0;
    h[7] = (h[7] + hh) >>> 0;
  }
  return h.map((x) => x.toString(16).padStart(8, '0')).join('');
}

/**
 * `clientRequestId` of an imported session: `hk:<uuid>` / `hc:<id>`. An id that does not fit the
 * server's key (64 chars, `[A-Za-z0-9_.:-]`) is replaced by a prefix of its SHA-256.
 */
export function healthClientRequestId(s: HealthSession): string {
  const prefix = s.platform === 'apple_health' ? 'hk:' : 'hc:';
  if (prefix.length + s.id.length <= REQUEST_ID_MAX_LENGTH && REQUEST_ID_BODY_RE.test(s.id)) return prefix + s.id;
  return prefix + sha256Hex(s.id).slice(0, REQUEST_ID_MAX_LENGTH - prefix.length);
}

/**
 * What importing the session would create. The workout ends at the session's end and its day is
 * that moment's day in the user's zone (the same convention as the record written to Health).
 * `workout: null` — not importable, `reason` says why. Sessions of this app (`fromThisApp`) are
 * dropped by the caller before this.
 */
export function toImportCandidate(s: HealthSession, timeZone: string): ImportCandidate {
  const reject = (reason: ImportReason): ImportCandidate => ({ session: s, workout: null, reason });
  if (!IMPORT_EXERCISES.has(s.activity)) return reject('unsupported');
  if (s.distanceMeters == null || !Number.isFinite(s.distanceMeters)) return reject('no_distance');
  const meters = Math.round(s.distanceMeters);
  if (meters < MIN_IMPORT_METERS) return reject('too_short');
  if (meters > MAX_IMPORT_METERS) return reject('too_long');
  const startMs = new Date(s.start).getTime();
  const endMs = new Date(s.end).getTime();
  const seconds = Math.round((endMs - startMs) / 1000);
  if (!Number.isFinite(seconds) || seconds < 1 || seconds > MAX_IMPORT_SECONDS) return reject('no_duration');
  return {
    session: s,
    reason: null,
    workout: {
      exerciseType: s.activity as ImportWorkout['exerciseType'],
      reps: meters,
      durationSeconds: seconds,
      date: dayKeyInZone(new Date(endMs), timeZone),
      time: new Date(endMs).toISOString(),
      clientRequestId: healthClientRequestId(s),
    },
  };
}
