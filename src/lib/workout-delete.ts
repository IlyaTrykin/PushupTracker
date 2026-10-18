/**
 * `DELETE /api/workouts` body: `{ id, groupId? }` — as before (own workout, a group owner's member
 * workout with `groupId`, any for an admin); `{ clientRequestId }` — the offline outbox deletes a record
 * that may already have reached the server. By `clientRequestId` only the caller's own workout is
 * deleted, and a missing one is not an error (never arrived, deleted already): `{ ok: true }`.
 */
import { parseClientRequestId } from './workout-input';

export type WorkoutDeleteTarget =
  | { by: 'id'; id: string; groupId: string | null }
  | { by: 'clientRequestId'; clientRequestId: string };

export type WorkoutDeleteParse =
  | { ok: true; target: WorkoutDeleteTarget }
  | { ok: false; error: string; code?: 'WORKOUT_REQUEST_ID_INVALID' };

/** The part of Prisma's `workout` delegate used here (`prisma` fits as is). */
export type WorkoutDeleteDb = {
  workout: {
    deleteMany(args: { where: { userId: string; clientRequestId: string } }): Promise<{ count: number }>;
  };
};

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

export function parseWorkoutDeleteBody(body: unknown): WorkoutDeleteParse {
  const fields = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const id = text(fields.id);
  if (id) return { ok: true, target: { by: 'id', id, groupId: text(fields.groupId) || null } };

  if (fields.clientRequestId === undefined || fields.clientRequestId === null) return { ok: false, error: 'id обязателен' };
  const parsed = parseClientRequestId(fields.clientRequestId);
  if (!parsed.ok || !parsed.value) return { ok: false, error: 'Некорректный clientRequestId', code: 'WORKOUT_REQUEST_ID_INVALID' };
  return { ok: true, target: { by: 'clientRequestId', clientRequestId: parsed.value } };
}

/** Deletes `userId`'s workout created with `clientRequestId` (unique per user); none → still ok. */
export async function deleteOwnWorkoutByRequestId(
  userId: string,
  clientRequestId: string,
  db: WorkoutDeleteDb,
): Promise<{ ok: true; deleted: number }> {
  const { count } = await db.workout.deleteMany({ where: { userId, clientRequestId } });
  return { ok: true, deleted: count };
}
