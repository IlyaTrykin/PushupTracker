/**
 * Counting reps with the phone's sensors (interfaces.md §7, spec stories 35–41): the native
 * `RepCounter` plugin shows a full-screen camera (pose) or proximity («touch with the chest»)
 * screen and returns the count. Only in the app; on the site nothing here is offered.
 *
 * Pure part (tested): which modes an exercise has, which buttons the form shows, how the plugin's
 * answer or refusal turns into what the form does.
 */

import { registerPlugin } from '@capacitor/core';
import { isNativeApp } from '@/lib/platform';
import { MAX_DURATION_SECONDS, MAX_WORKOUT_VALUE } from '@/lib/workout-input';

export type RepCounterMode = 'camera' | 'proximity';
export type RepCountExercise = 'pushups' | 'squats' | 'pullups';
export type RepCounterUnavailableReason = 'no_camera' | 'no_sensor' | 'unsupported_os';
export type RepCounterAvailability = { available: boolean; reason?: RepCounterUnavailableReason };
/** What `RepCounter.start` resolves with. */
export type RepCountResult = { reps: number; durationSeconds: number; cancelled: boolean };

export type RepCountOutcome =
  | { kind: 'counted'; reps: number; durationSeconds: number }
  | { kind: 'cancelled' }
  /** «Готово» with nothing counted: the form keeps what it had. */
  | { kind: 'empty' }
  | { kind: 'permission_denied' }
  | { kind: 'unavailable'; reason: RepCounterUnavailableReason }
  | { kind: 'error'; message: string };

const MODES: Record<RepCountExercise, RepCounterMode[]> = {
  pushups: ['camera', 'proximity'],
  squats: ['camera'],
  pullups: ['camera'],
};

const UNAVAILABLE_REASONS: readonly RepCounterUnavailableReason[] = ['no_camera', 'no_sensor', 'unsupported_os'];

export function isRepCountExercise(exerciseType: string): exerciseType is RepCountExercise {
  return Object.prototype.hasOwnProperty.call(MODES, exerciseType);
}

/** Counting modes an exercise supports (regardless of the device). */
export function repCounterModes(exerciseType: string): RepCounterMode[] {
  return isRepCountExercise(exerciseType) ? [...MODES[exerciseType]] : [];
}

/**
 * Buttons the workout form shows: none on the site; «touch» only when the device reported a
 * proximity sensor; «camera» always in the app — a phone without a camera (the iOS simulator)
 * opens the screen that explains it — unless the system is too old for pose detection.
 */
export function visibleRepCounterModes(
  exerciseType: string,
  options: { native: boolean; availability: Partial<Record<RepCounterMode, RepCounterAvailability>> },
): RepCounterMode[] {
  if (!options.native) return [];
  return repCounterModes(exerciseType).filter((mode) => {
    const availability = options.availability[mode];
    if (mode === 'proximity') return availability?.available === true;
    return availability?.reason !== 'unsupported_os';
  });
}

function wholeNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

function errorCode(error: unknown): string | null {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
  }
  return null;
}

/** The plugin's answer (or its refusal) → what the form does with it. */
export function toRepCountOutcome(
  settled: { ok: true; value: unknown } | { ok: false; error: unknown },
): RepCountOutcome {
  if (!settled.ok) {
    const code = errorCode(settled.error);
    if (code === 'permission_denied') return { kind: 'permission_denied' };
    if (code && (UNAVAILABLE_REASONS as readonly string[]).includes(code)) {
      return { kind: 'unavailable', reason: code as RepCounterUnavailableReason };
    }
    const message = settled.error instanceof Error ? settled.error.message : String(settled.error);
    return { kind: 'error', message };
  }
  const value = (settled.value && typeof settled.value === 'object' ? settled.value : {}) as Partial<Record<keyof RepCountResult, unknown>>;
  if (value.cancelled === true) return { kind: 'cancelled' };
  const reps = wholeNumber(value.reps);
  if (reps === null || reps <= 0) return { kind: 'empty' };
  const duration = wholeNumber(value.durationSeconds) ?? 1;
  return {
    kind: 'counted',
    reps: Math.min(MAX_WORKOUT_VALUE, reps),
    durationSeconds: Math.min(MAX_DURATION_SECONDS, Math.max(1, duration)),
  };
}

type RepCounterPlugin = {
  isAvailable(options: { mode: RepCounterMode }): Promise<RepCounterAvailability>;
  start(options: { mode: RepCounterMode; exerciseType: RepCountExercise; locale: 'ru' | 'en' }): Promise<RepCountResult>;
  openSettings(): Promise<void>;
};

let plugin: RepCounterPlugin | null = null;

function bridge(): RepCounterPlugin {
  if (!plugin) plugin = registerPlugin<RepCounterPlugin>('RepCounter');
  return plugin;
}

/** Whether the device can count in this mode; on the site — never. */
export async function repCounterAvailability(mode: RepCounterMode): Promise<RepCounterAvailability> {
  if (!isNativeApp()) return { available: false, reason: 'unsupported_os' };
  try {
    return await bridge().isAvailable({ mode });
  } catch (error) {
    console.warn('[rep-counter] isAvailable failed', error);
    return { available: false, reason: mode === 'camera' ? 'no_camera' : 'no_sensor' };
  }
}

/** Opens the native counting screen; resolves when the user taps «Готово» or «Отмена». */
export async function countReps(
  mode: RepCounterMode,
  exerciseType: RepCountExercise,
  locale: 'ru' | 'en' = 'ru',
): Promise<RepCountOutcome> {
  if (!isNativeApp()) return { kind: 'unavailable', reason: 'unsupported_os' };
  try {
    const value = await bridge().start({ mode, exerciseType, locale });
    return toRepCountOutcome({ ok: true, value });
  } catch (error) {
    return toRepCountOutcome({ ok: false, error });
  }
}

/** The app's page in the system settings (to allow the camera after a refusal). */
export async function openRepCounterSettings(): Promise<void> {
  if (!isNativeApp()) return;
  try {
    await bridge().openSettings();
  } catch (error) {
    console.warn('[rep-counter] openSettings failed', error);
  }
}
