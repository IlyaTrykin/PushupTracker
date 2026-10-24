import { NextResponse } from 'next/server';
import { AuthError, requireUser } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  CircuitError,
  customCircuitView,
  parseCustomCircuitInput,
  storedCircuitStations,
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

type Ctx = { params: Promise<{ id: string }> };

/** Правка своего круга: недостающие поля — из сохранённого; чужой или несуществующий — 404. */
export async function PATCH(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const current = await prisma.customCircuit.findFirst({ where: { id, userId: user.id }, select: CIRCUIT_SELECT });
    if (!current) return jsonError('Круг не найден', 404, 'CIRCUIT_NOT_FOUND');

    const body = await request.json().catch(() => null);
    const input = parseCustomCircuitInput(body, {
      title: current.title,
      stations: storedCircuitStations(current.stations),
      rounds: current.rounds,
      restStationSec: current.restStationSec,
      restRoundSec: current.restRoundSec,
    });

    const updated = await prisma.customCircuit.updateMany({ where: { id, userId: user.id }, data: input });
    if (updated.count !== 1) return jsonError('Круг не найден', 404, 'CIRCUIT_NOT_FOUND');
    const row = await prisma.customCircuit.findFirst({ where: { id, userId: user.id }, select: CIRCUIT_SELECT });
    if (!row) return jsonError('Круг не найден', 404, 'CIRCUIT_NOT_FOUND');
    return NextResponse.json({ ok: true, circuit: customCircuitView(row) });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    if (e instanceof CircuitError) return jsonError(e.message, e.status, e.code, e.stationIndex);
    console.error('CIRCUIT PATCH ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}

/** Удаление своего круга; уже записанные тренировки его станций остаются. */
export async function DELETE(request: Request, ctx: Ctx) {
  try {
    const user = await requireUser(request);
    const { id } = await ctx.params;
    const deleted = await prisma.customCircuit.deleteMany({ where: { id, userId: user.id } });
    if (deleted.count !== 1) return jsonError('Круг не найден', 404, 'CIRCUIT_NOT_FOUND');
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof AuthError) return jsonError('Не авторизован', e.status);
    console.error('CIRCUIT DELETE ERROR:', e);
    return jsonError('Внутренняя ошибка сервера', 500);
  }
}
