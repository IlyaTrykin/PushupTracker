/**
 * Import of run / bike / row sessions from Apple Health / Health Connect (interfaces.md §6).
 * The app reads the sessions and sends the ones the user ticked; every item is created through the
 * common `createWorkoutForUser` path (points, records, achievements, daily limit charged to the
 * user as in ADR 0011). `clientRequestId` (`hk:` / `hc:` + the Health id) makes a repeat a duplicate.
 */

import { isImportedFromHealth } from './health/reconcile';
import { WorkoutCreateError, type CreateWorkout } from './workout-create';

export const HEALTH_IMPORT_MAX_ITEMS = 50;
export const HEALTH_IMPORT_MAX_IDS = 500;

const IMPORT_EXERCISES: readonly string[] = ['run', 'bike', 'row'];

export type HealthImportItem = {
  clientRequestId: string;
  exerciseType: 'run' | 'bike' | 'row';
  /** Metres. */
  reps: number;
  durationSeconds: number;
  date: string;
  time: string;
};

export type HealthImportResult = {
  clientRequestId: string;
  status: 'created' | 'duplicate' | 'rejected';
  workoutId?: string;
  error?: string;
};

export type HealthImportUser = { id: string; username: string; timeZone?: string | null };

export type HealthImportDeps = { createWorkout: CreateWorkout };

export class HealthImportError extends Error {
  constructor(
    message: string,
    public status: 400 = 400,
  ) {
    super(message);
    this.name = 'HealthImportError';
  }
}

export const HEALTH_IMPORT_LIMIT_CODE = 'RATE_LIMITED';

function validateItem(raw: unknown): HealthImportItem | string {
  if (!raw || typeof raw !== 'object') return 'Некорректная запись';
  const item = raw as Record<string, unknown>;
  if (typeof item.clientRequestId !== 'string' || !isImportedFromHealth(item.clientRequestId)) return 'Некорректный clientRequestId';
  if (typeof item.exerciseType !== 'string' || !IMPORT_EXERCISES.includes(item.exerciseType)) return 'Импортируются только бег, велосипед и гребля';
  return item as unknown as HealthImportItem;
}

/**
 * Creates up to 50 workouts; the answer has an entry per item, in order. One item's refusal does not
 * stop the others; the daily limit does (the rest comes back `rejected` with `RATE_LIMITED`).
 */
export async function importHealthWorkouts(
  user: HealthImportUser,
  items: HealthImportItem[],
  deps: HealthImportDeps,
): Promise<{ results: HealthImportResult[] }> {
  if (!Array.isArray(items)) throw new HealthImportError('items должен быть списком');
  if (items.length > HEALTH_IMPORT_MAX_ITEMS) throw new HealthImportError(`Не больше ${HEALTH_IMPORT_MAX_ITEMS} тренировок за запрос`);

  const results: HealthImportResult[] = [];
  let limited = false;
  for (const raw of items) {
    const requestId = raw && typeof (raw as { clientRequestId?: unknown }).clientRequestId === 'string' ? (raw as HealthImportItem).clientRequestId : '';
    const item = validateItem(raw);
    if (typeof item === 'string') {
      results.push({ clientRequestId: requestId, status: 'rejected', error: item });
      continue;
    }
    if (limited) {
      results.push({ clientRequestId: item.clientRequestId, status: 'rejected', error: HEALTH_IMPORT_LIMIT_CODE });
      continue;
    }
    try {
      const created = await deps.createWorkout(
        user,
        {
          exerciseType: item.exerciseType,
          reps: item.reps,
          durationSeconds: item.durationSeconds,
          date: item.date,
          time: item.time,
          clientRequestId: item.clientRequestId,
        },
        { source: 'health', actorId: user.id },
      );
      results.push({ clientRequestId: item.clientRequestId, status: created.replayed ? 'duplicate' : 'created', workoutId: created.workout.id });
    } catch (e) {
      if (e instanceof WorkoutCreateError) {
        if (e.status === 429) limited = true;
        results.push({ clientRequestId: item.clientRequestId, status: 'rejected', error: e.status === 429 ? HEALTH_IMPORT_LIMIT_CODE : e.message });
      } else {
        console.error('HEALTH IMPORT ERROR:', e);
        results.push({ clientRequestId: item.clientRequestId, status: 'rejected', error: 'Внутренняя ошибка сервера' });
      }
    }
  }
  return { results };
}

export type FindImportedDeps = {
  /** Which of the ids are `clientRequestId` of the user's workouts. */
  findExistingRequestIds(userId: string, ids: string[]): Promise<string[]>;
};

/** Of the asked Health keys, those already in the tracker (at most 500 asked). */
export async function findImportedIds(userId: string, ids: string[], deps: FindImportedDeps): Promise<string[]> {
  if (!Array.isArray(ids)) throw new HealthImportError('clientRequestIds должен быть списком');
  if (ids.length > HEALTH_IMPORT_MAX_IDS) throw new HealthImportError(`Не больше ${HEALTH_IMPORT_MAX_IDS} идентификаторов за запрос`);
  const asked = ids.filter((id): id is string => typeof id === 'string' && isImportedFromHealth(id));
  if (!asked.length) return [];
  return deps.findExistingRequestIds(userId, asked);
}
