import { NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthError, requireUser } from '@/lib/auth';
import { PROFILE_SELECT, pickBodyMetricUpdates, type BodySex, type HealthBodyMetrics } from '@/lib/body-metrics';
import { backfillWorkoutEnergy, weightAppeared } from '@/lib/workout-energy';

export const dynamic = 'force-dynamic';

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function optionalNumber(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function optionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

type Tx = Prisma.TransactionClient;

/** Последнее изменение поля по истории профиля (для профилей без `*UpdatedAt`). */
async function lastHistoryChange(tx: Tx, userId: string, field: 'weightKg' | 'heightCm'): Promise<Date | null> {
  const rows = await tx.$queryRaw<{ changedAt: Date | null }[]>`
    SELECT max("changedAt") AS "changedAt" FROM "UserProfileHistory"
    WHERE "userId" = ${userId} AND "changes" -> ${field} IS NOT NULL`;
  return rows[0]?.changedAt ?? null;
}

function readHealthBody(body: Record<string, unknown>): HealthBodyMetrics {
  return {
    weightKg: optionalNumber(body.weightKg),
    weightMeasuredAt: optionalString(body.weightMeasuredAt),
    heightCm: optionalNumber(body.heightCm),
    heightMeasuredAt: optionalString(body.heightMeasuredAt),
    birthDate: optionalString(body.birthDate),
    sex: (optionalString(body.sex)?.toLowerCase() ?? null) as BodySex | null,
  };
}

// Данные тела из Apple Health / Health Connect (только свой профиль):
// { weightKg?, weightMeasuredAt?, heightCm?, heightMeasuredAt?, birthDate? ('YYYY-MM-DD'), sex? }.
// Вес/рост заменяют профиль, только если замер свежее последнего изменения (`*UpdatedAt`, иначе
// последняя запись истории профиля с этим полем, иначе User.updatedAt) или поле пустое и не очищено
// вручную (очищенное — `*UpdatedAt`/история — заполняет только замер новее очистки) —
// источник становится 'health'; дата рождения и пол пишутся только в пустые поля
// (правило — `pickBodyMetricUpdates`). Ответ: { ok, changed: string[], user: профиль }.
export async function POST(request: Request) {
  try {
    const me = await requireUser(request);
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return jsonError('Некорректный JSON');
    const fromHealth = readHealthBody(body as Record<string, unknown>);

    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUnique({
        where: { id: me.id },
        select: {
          weightKg: true,
          weightUpdatedAt: true,
          heightCm: true,
          heightUpdatedAt: true,
          birthDate: true,
          gender: true,
          updatedAt: true,
          deletedAt: true,
        },
      });
      if (!current || current.deletedAt) return null;

      // Вес/рост из профилей до появления `*UpdatedAt`: дата сравнения — история, иначе updatedAt.
      // У пустого поля запись в истории значит «очищено вручную»: заполнит только замер новее (R04.1).
      const weightLastChangedAt = !current.weightUpdatedAt ? await lastHistoryChange(tx, me.id, 'weightKg') : null;
      const heightLastChangedAt = !current.heightUpdatedAt ? await lastHistoryChange(tx, me.id, 'heightCm') : null;
      const updates = pickBodyMetricUpdates(
        { ...current, weightLastChangedAt, heightLastChangedAt, profileUpdatedAt: current.updatedAt },
        fromHealth,
      );
      const data: Prisma.UserUpdateInput = {};
      const changes: Record<string, Prisma.InputJsonValue | null> = {};

      if (updates.weightKg !== undefined) {
        data.weightKg = updates.weightKg;
        data.weightUpdatedAt = updates.weightUpdatedAt;
        data.weightSource = updates.weightSource;
        if (updates.weightKg !== current.weightKg) changes.weightKg = { from: current.weightKg, to: updates.weightKg };
      }
      if (updates.heightCm !== undefined) {
        data.heightCm = updates.heightCm;
        data.heightUpdatedAt = updates.heightUpdatedAt;
        data.heightSource = updates.heightSource;
        if (updates.heightCm !== current.heightCm) changes.heightCm = { from: current.heightCm, to: updates.heightCm };
      }
      if (updates.birthDate !== undefined) {
        data.birthDate = new Date(`${updates.birthDate}T00:00:00Z`);
        changes.birthDate = { from: null, to: updates.birthDate };
      }
      if (updates.gender !== undefined) {
        data.gender = updates.gender;
        changes.gender = { from: null, to: updates.gender };
      }

      const user = Object.keys(data).length
        ? await tx.user.update({ where: { id: me.id }, data, select: PROFILE_SELECT })
        : await tx.user.findUniqueOrThrow({ where: { id: me.id }, select: PROFILE_SELECT });
      if (Object.keys(changes).length) {
        await tx.userProfileHistory.create({ data: { userId: me.id, changedById: me.id, changes } });
      }
      return { user, changed: Object.keys(changes), weightAppeared: weightAppeared(current.weightKg, user.weightKg) };
    });

    if (!result) return jsonError('UNAUTHORIZED', 401);
    // R01.7: первый вес (из Health) — досчитать калории тренировок без них; ошибка не мешает ответу.
    if (result.weightAppeared) {
      await backfillWorkoutEnergy(me.id).catch((e) => console.error('ENERGY BACKFILL ERROR:', e));
    }
    return NextResponse.json({ ok: true, changed: result.changed, user: result.user });
  } catch (e) {
    if (e instanceof AuthError) return jsonError(e.message, e.status);
    return jsonError('INTERNAL_ERROR', 500);
  }
}
