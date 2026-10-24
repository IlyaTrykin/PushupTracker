import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  CIRCUIT_MAX_CUSTOM,
  CircuitError,
  customCircuitView,
  parseCustomCircuitInput,
} from '@/lib/circuits';

export const dynamic = 'force-dynamic';

const CIRCUIT_SELECT = {
  id: true,
  title: true,
  stations: true,
  rounds: true,
  restStationSec: true,
  restRoundSec: true,
  createdAt: true,
  updatedAt: true,
} as const;

function jsonError(message: string, status = 400, code?: string, stationIndex?: number) {
  return NextResponse.json(
    { error: message, ...(code ? { code } : {}), ...(stationIndex != null ? { stationIndex } : {}) },
    { status },
  );
}

class LimitReached extends Error {}

/** Свои круги пользователя (R09.2): список с предупреждениями о сочетании станций. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const rows = await prisma.customCircuit.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: CIRCUIT_SELECT,
    });
    return NextResponse.json({ circuits: rows.map(customCircuitView), limit: CIRCUIT_MAX_CUSTOM });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('CIRCUITS GET ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

/**
 * Новый свой круг: до 20 на пользователя, до 10 станций; выходы силой и толчок гири — 400
 * (CIRCUIT_EXERCISE_EXCLUDED). Плохое сочетание не мешает сохранить — в ответе `warnings`.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const body = await request.json().catch(() => null);
    const input = parseCustomCircuitInput(body);

    const row = await prisma.$transaction(async (tx) => {
      // Один пользователь за раз: два параллельных сохранения не обойдут лимит.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`custom-circuit:${user.id}`}))`;
      const count = await tx.customCircuit.count({ where: { userId: user.id } });
      if (count >= CIRCUIT_MAX_CUSTOM) throw new LimitReached();
      return tx.customCircuit.create({
        data: { userId: user.id, ...input, stations: input.stations },
        select: CIRCUIT_SELECT,
      });
    });

    return NextResponse.json({ ok: true, circuit: customCircuitView(row) });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof CircuitError) return jsonError(e.message, e.status, e.code, e.stationIndex);
    if (e instanceof LimitReached) {
      return jsonError(`Не больше ${CIRCUIT_MAX_CUSTOM} своих кругов`, 409, 'CIRCUIT_LIMIT_REACHED');
    }
    console.error('CIRCUITS POST ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
