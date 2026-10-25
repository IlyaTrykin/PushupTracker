import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKeyInZone, localHHMM } from './calendar-day';
import { EXERCISE_IDS } from './exercises';
import {
  PROGRAM_EXERCISE_TYPES,
  ProgramError,
  buildDistancePlan,
  distanceTargetLimit,
  buildProgramDraft,
  buildCircuitProgramDraft,
  parseCircuitProgramCreateBody,
  isCircuitProgramBody,
  canAutofillProgram,
  isProgramExerciseType,
  nextKettlebellLoad,
  parseProgramCreateBody,
  programCoefficient,
  programLabel,
  programSetWorkoutInput,
  programStartAlternatives,
  resolveSetResult,
  restoredSetWorkoutRows,
  evaluateProgramOutcome,
  autofilledDays,
  recordClaimedSet,
  isSessionOpenForSets,
  planOverdueAutofill,
  planProgramExtension,
  programReplacementWhere,
  programSetWorkoutTime,
  programWorkoutDate,
  resolveProgramStartDay,
  setsMissingWorkouts,
  shiftInstantByDays,
  type ProgramOutcomeSession,
} from './program-plan';

const MOSCOW = 'Europe/Moscow';
const YEKATERINBURG = 'Asia/Yekaterinburg';

const baseInput = {
  exerciseType: 'pushups' as const,
  baselineMaxReps: 20,
  targetReps: 30,
  durationWeeks: 4,
  frequencyPerWeek: 3,
  ageYears: 30,
  weightKg: 75,
  sex: 'male',
};

test('Moscow: sessions are planned at 19:00 local on their own day', () => {
  const draft = buildProgramDraft(
    { ...baseInput, startDate: '2026-10-12' },
    { now: new Date('2026-10-10T09:00:00Z'), timeZone: MOSCOW },
  );
  assert.equal(draft.startDay, '2026-10-12');
  // 19:00 MSK (UTC+3) = 16:00 UTC
  assert.equal(draft.sessions[0].scheduledAt.toISOString(), '2026-10-12T16:00:00.000Z');
  for (const s of draft.sessions) {
    assert.equal(localHHMM(s.scheduledAt, MOSCOW), '19:00');
    assert.equal(dayKeyInZone(s.scheduledAt, MOSCOW), s.day);
  }
  assert.equal(draft.sessions.at(-1)?.isFinalTest, true);
});

test('Yekaterinburg: first session stays on the start day (not 00:00 the next day)', () => {
  const draft = buildProgramDraft(
    { ...baseInput, startDate: '2026-10-10' },
    { now: new Date('2026-10-10T05:00:00Z'), timeZone: YEKATERINBURG },
  );
  // 19:00 YEKT (UTC+5) = 14:00 UTC
  assert.equal(draft.sessions[0].scheduledAt.toISOString(), '2026-10-10T14:00:00.000Z');
  assert.equal(dayKeyInZone(draft.sessions[0].scheduledAt, YEKATERINBURG), '2026-10-10');
  for (const s of draft.sessions) assert.equal(localHHMM(s.scheduledAt, YEKATERINBURG), '19:00');
});

test('start day without an explicit date is "today" in the user zone', () => {
  const justAfterMidnightMsk = new Date('2026-10-09T21:30:00Z'); // 10.10 00:30 MSK
  assert.equal(resolveProgramStartDay(null, { now: justAfterMidnightMsk, timeZone: MOSCOW }), '2026-10-10');
  assert.equal(resolveProgramStartDay(null, { now: justAfterMidnightMsk, timeZone: 'UTC' }), '2026-10-09');
});

test('a set done at 00:30 Moscow time is dated that same day', () => {
  const at = new Date('2026-10-09T21:30:00Z'); // 10.10 00:30 MSK
  assert.equal(programWorkoutDate(at, MOSCOW).toISOString(), '2026-10-10T00:00:00.000Z');
});

test('shifting keeps the local wall time', () => {
  const at = new Date('2026-10-12T16:00:00Z'); // 19:00 MSK
  assert.equal(shiftInstantByDays(at, 3, MOSCOW).toISOString(), '2026-10-15T16:00:00.000Z');
  assert.equal(shiftInstantByDays(at, -2, MOSCOW).toISOString(), '2026-10-10T16:00:00.000Z');
});

function asOutcomeSessions(
  draftSessions: Array<{ sessionNumber: number; isFinalTest: boolean; scheduledAt: Date; sets: Array<{ isKeySet: boolean }> }>,
): ProgramOutcomeSession[] {
  return draftSessions.map((s) => ({
    sessionNumber: s.sessionNumber,
    isFinalTest: s.isFinalTest,
    completed: false,
    scheduledAt: s.scheduledAt,
    completedAt: null,
    sets: s.sets.map((st) => ({ isKeySet: st.isKeySet, actualReps: null })),
  }));
}

function completeAll(sessions: ProgramOutcomeSession[], finalTestReps: number) {
  for (const s of sessions) {
    if (s.completed) continue;
    s.completed = true;
    s.completedAt = s.scheduledAt;
    s.sets = s.sets.map((st) => ({ ...st, actualReps: s.isFinalTest ? finalTestReps : 10 }));
  }
}

test('failed final test → extension → passed retest → completed', () => {
  const clock = { now: new Date('2026-10-01T09:00:00Z'), timeZone: MOSCOW };
  const draft = buildProgramDraft({ ...baseInput, startDate: '2026-10-01' }, clock);
  const sessions = asOutcomeSessions(draft.sessions);
  assert.equal(evaluateProgramOutcome(sessions, 30).kind, 'in_progress');

  completeAll(sessions, 25); // first final test: 25 of 30
  const failed = evaluateProgramOutcome(sessions, 30);
  assert.equal(failed.kind, 'extend');
  if (failed.kind !== 'extend') return;
  assert.equal(failed.finalTestActual, 25);

  const extension = planProgramExtension({
    targetReps: 30,
    finalTestActual: failed.finalTestActual,
    frequencyPerWeek: 3,
    startDay: draft.startDay,
    lastTestDay: dayKeyInZone(failed.finalTest.scheduledAt, MOSCOW),
    existingDays: draft.sessions.map((s) => s.day),
    nextSessionNumber: Math.max(...sessions.map((s) => s.sessionNumber)) + 1,
    clock,
  });
  assert.equal(extension.at(-1)?.isFinalTest, true);
  sessions.push(...asOutcomeSessions(extension));
  assert.equal(evaluateProgramOutcome(sessions, 30).kind, 'in_progress');

  completeAll(sessions, 32); // retest: 32 of 30
  const outcome = evaluateProgramOutcome(sessions, 30);
  assert.equal(outcome.kind, 'completed');
  if (outcome.kind === 'completed') assert.equal(outcome.finalTestActual, 32);
});

test('a passed retest completes the program even if stale sessions were generated after it', () => {
  const at = new Date('2026-10-01T16:00:00Z');
  const session = (sessionNumber: number, isFinalTest: boolean, completed: boolean, key: number | null) => ({
    sessionNumber,
    isFinalTest,
    completed,
    scheduledAt: at,
    completedAt: completed ? at : null,
    sets: [{ isKeySet: true, actualReps: key }],
  });
  const sessions = [
    session(1, false, true, 20),
    session(2, true, true, 25), // failed
    session(3, false, true, 28),
    session(4, true, true, 31), // passed
    session(5, false, false, null), // generated by the old bug
    session(6, true, false, null),
  ];
  assert.equal(evaluateProgramOutcome(sessions, 30).kind, 'completed');
});

test('extension after a long-past test is planned from today, never in the past', () => {
  const clock = { now: new Date('2026-10-10T09:00:00Z'), timeZone: MOSCOW };
  const extension = planProgramExtension({
    targetReps: 30,
    finalTestActual: 25,
    frequencyPerWeek: 3,
    startDay: '2026-07-01',
    lastTestDay: '2026-09-01',
    existingDays: ['2026-08-28', '2026-08-30', '2026-09-01'],
    nextSessionNumber: 20,
    clock,
  });
  assert.ok(extension.length >= 3);
  for (const s of extension) assert.ok(s.day > '2026-10-10', `${s.day} is not after today`);
  assert.deepEqual(extension.map((s) => s.sessionNumber), extension.map((_, i) => 20 + i));
});

test('overdue final test is not filled from the day total of ordinary workouts', () => {
  const clock = { now: new Date('2026-10-10T09:00:00Z'), timeZone: MOSCOW };
  const sets5 = [1, 2, 3, 4, 5].map((n) => ({ id: `s${n}`, targetReps: 10 }));
  const plan = planOverdueAutofill({
    sessions: [
      { id: 'training', scheduledAt: new Date('2026-10-07T16:00:00Z'), isFinalTest: false, sets: sets5 },
      { id: 'test', scheduledAt: new Date('2026-10-09T16:00:00Z'), isFinalTest: true, sets: [{ id: 't1', targetReps: 40 }] },
      { id: 'today', scheduledAt: new Date('2026-10-10T16:00:00Z'), isFinalTest: false, sets: sets5 },
    ],
    dayTotals: new Map([['2026-10-07', 50], ['2026-10-09', 48], ['2026-10-10', 50]]),
    clock,
  });
  assert.deepEqual(plan.map((p) => p.sessionId), ['training']);
  assert.equal(plan[0].sets.reduce((sum, s) => sum + s.actualReps, 0), 50);
});

test('a future session that was not started cannot take sets', () => {
  const clock = { now: new Date('2026-10-10T09:00:00Z'), timeZone: MOSCOW };
  const tomorrow = new Date('2026-10-11T16:00:00Z');
  assert.equal(isSessionOpenForSets({ scheduledAt: tomorrow, startedAt: null }, clock), false);
  assert.equal(isSessionOpenForSets({ scheduledAt: tomorrow, startedAt: clock.now }, clock), true);
  // 00:30 MSK on the session day — already "today" for a Moscow user
  const afterMidnight = { now: new Date('2026-10-10T21:30:00Z'), timeZone: MOSCOW };
  assert.equal(isSessionOpenForSets({ scheduledAt: tomorrow, startedAt: null }, afterMidnight), true);
});

test('completion backfills the workout of the deleted set, not of the last one', () => {
  const t0 = new Date('2026-10-10T16:00:00Z');
  const sets = [12, 14, 16, 14, 20].map((reps, i) => ({
    setNumber: i + 1,
    actualReps: reps,
    completedAt: new Date(t0.getTime() + i * 120_000),
  }));
  // the workout of set 2 was deleted on the dashboard
  const workouts = sets
    .filter((s) => s.setNumber !== 2)
    .map((s) => ({ time: programSetWorkoutTime(s.completedAt, s.setNumber), reps: s.actualReps }));
  assert.deepEqual(setsMissingWorkouts(sets, workouts).map((s) => s.setNumber), [2]);
  // edited reps still match by time
  workouts[0] = { ...workouts[0], reps: 99 };
  assert.deepEqual(setsMissingWorkouts(sets, workouts).map((s) => s.setNumber), [2]);
  assert.deepEqual(setsMissingWorkouts(sets, []).map((s) => s.setNumber), [1, 2, 3, 4, 5]);
});

/** The equality semantics of a Prisma `where` with plain values (null matches IS NULL). */
function matchesWhere(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

test('a group assignment replaces only that group\'s program, never the personal one (the updateMany filter)', () => {
  const programs = [
    { id: 'personal', userId: 'u1', exerciseType: 'pushups', isActive: true, managedByGroupId: null },
    { id: 'group-1', userId: 'u1', exerciseType: 'pushups', isActive: true, managedByGroupId: 'g1' },
    { id: 'group-2', userId: 'u1', exerciseType: 'pushups', isActive: true, managedByGroupId: 'g2' },
    { id: 'squats', userId: 'u1', exerciseType: 'squats', isActive: true, managedByGroupId: null },
    { id: 'other-user', userId: 'u2', exerciseType: 'pushups', isActive: true, managedByGroupId: null },
    { id: 'old', userId: 'u1', exerciseType: 'pushups', isActive: false, managedByGroupId: 'g1' },
  ];
  const replaced = (managedByGroupId: string | null | undefined) =>
    programs.filter((p) => matchesWhere(p, programReplacementWhere('u1', 'pushups', managedByGroupId))).map((p) => p.id);

  assert.deepEqual(replaced('g1'), ['group-1']);
  assert.deepEqual(replaced(null), ['personal']);
  assert.deepEqual(replaced(undefined), ['personal']);
});

test('two programs on one exercise: one ordinary workout day closes at most one overdue session', () => {
  const clock = { now: new Date('2026-10-10T09:00:00Z'), timeZone: MOSCOW };
  const sets = (p: string) => [1, 2, 3].map((n) => ({ id: `${p}${n}`, targetReps: 10 }));
  const dayTotals = new Map([['2026-10-07', 30]]);
  const personal = { id: 'personal', scheduledAt: new Date('2026-10-07T16:00:00Z'), isFinalTest: false, sets: sets('p') };
  const group = { id: 'group', scheduledAt: new Date('2026-10-07T16:00:00Z'), isFinalTest: false, sets: sets('g') };

  const first = planOverdueAutofill({ sessions: [personal], dayTotals, clock });
  assert.deepEqual(first.map((p) => p.sessionId), ['personal']);

  // The second program sees that the day was already used by the first one.
  const second = planOverdueAutofill({ sessions: [group], dayTotals, clock, consumedDays: new Set(['2026-10-07']) });
  assert.deepEqual(second, []);
});

test('days already closed by autofill are recognised by completedAt = scheduledAt, not by a normal completion', () => {
  const at = new Date('2026-10-07T16:00:00Z');
  const days = autofilledDays([
    // autofill marks the session done at its own scheduled time
    { scheduledAt: at, completed: true, completedAt: at },
    // a session the user went through himself on 2026-10-08
    { scheduledAt: new Date('2026-10-08T16:00:00Z'), completed: true, completedAt: new Date('2026-10-08T17:12:00Z') },
    { scheduledAt: new Date('2026-10-09T16:00:00Z'), completed: false, completedAt: null },
  ], MOSCOW);
  assert.deepEqual([...days], ['2026-10-07']);
});

test('a program set: only the request that claims the set creates its workout; a failed creation releases the set', async () => {
  const log: string[] = [];
  const steps = (claimed: boolean, createFails = false) => ({
    claim: async () => { log.push('claim'); return claimed; },
    create: async () => { log.push('create'); if (createFails) throw new Error('RATE_LIMITED'); return 'workout'; },
    release: async () => { log.push('release'); },
  });

  assert.equal(await recordClaimedSet(steps(true)), 'workout');
  assert.deepEqual(log.splice(0), ['claim', 'create']);

  // a parallel copy lost the claim: no workout, no points, no notifications
  assert.equal(await recordClaimedSet(steps(false)), null);
  assert.deepEqual(log.splice(0), ['claim']);

  // over the daily limit: the set is free again and the error reaches the caller
  await assert.rejects(recordClaimedSet(steps(true, true)), /RATE_LIMITED/);
  assert.deepEqual(log.splice(0), ['claim', 'create', 'release']);
});

// ---------------------------------------------------------------------------
// Программы для всех упражнений (R08)
// ---------------------------------------------------------------------------

const clockOct = { now: new Date('2026-10-12T09:00:00Z'), timeZone: MOSCOW };

test('R08: every catalog exercise (24) can take a program; unknown types and circuits cannot', () => {
  assert.equal(PROGRAM_EXERCISE_TYPES.length, 24);
  for (const id of EXERCISE_IDS) {
    assert.ok(isProgramExerciseType(id), id);
    assert.ok(programCoefficient(id) > 0, `${id} has a coefficient`);
  }
  assert.equal(isProgramExerciseType('circuit'), false);
  assert.equal(isProgramExerciseType('jumping_jacks'), false);
});

test('R08.1: a repetition exercise (dips) reaches its target like push-ups, with its own coefficient', () => {
  const draft = buildProgramDraft({ ...baseInput, exerciseType: 'dips', baselineMaxReps: 8, targetReps: 15, startDate: '2026-10-12' }, clockOct);
  assert.equal(draft.clean.exerciseType, 'dips');
  assert.equal(draft.sessions.at(-1)?.isFinalTest, true);
  assert.equal(draft.sessions.at(-1)?.sets[0].targetReps, 15);
  for (const s of draft.sessions) for (const st of s.sets) assert.equal(st.loadKg ?? null, null);
  assert.notEqual(programCoefficient('dips'), programCoefficient('pushups'));
});

test('R08.3: a timed exercise (wall sit) plans seconds; the final test is the target hold', () => {
  const draft = buildProgramDraft({ ...baseInput, exerciseType: 'wall_sit', baselineMaxReps: 60, targetReps: 120, startDate: '2026-10-12' }, clockOct);
  const final = draft.sessions.at(-1);
  assert.equal(final?.isFinalTest, true);
  assert.equal(final?.sets[0].targetReps, 120);
  assert.ok(draft.sessions[0].sets.every((st) => st.targetReps >= 1 && st.targetReps <= 120));
});

test('R08.4: a set of a one-side exercise records both sides; the weaker side counts for the per-side target', () => {
  assert.deepEqual(resolveSetResult('lunges', { actualLeft: 10, actualRight: 12 }), {
    actualReps: 10, actualLeft: 10, actualRight: 12, actualSeconds: null,
  });
  // an old client sends one number — both sides did it
  assert.deepEqual(resolveSetResult('side_plank', { actualReps: 30 }), {
    actualReps: 30, actualLeft: 30, actualRight: 30, actualSeconds: null,
  });
  // sides do not apply to two-handed exercises
  assert.deepEqual(resolveSetResult('pushups', { actualReps: 20, actualLeft: 5 }), {
    actualReps: 20, actualLeft: null, actualRight: null, actualSeconds: null,
  });
  assert.throws(() => resolveSetResult('lunges', { actualLeft: 0, actualRight: 0 }), ProgramError);
  assert.throws(() => resolveSetResult('pushups', {}), ProgramError);

  const input = programSetWorkoutInput({
    setId: 'set1', setNumber: 2, exerciseType: 'kettlebell_press', loadKg: 16,
    actualReps: 6, actualLeft: 6, actualRight: 7, actualSeconds: null,
    doneAt: new Date('2026-10-12T16:00:00Z'), timeZone: MOSCOW,
  });
  assert.equal(input.reps, 13);
  assert.equal(input.repsLeft, 6);
  assert.equal(input.repsRight, 7);
  assert.equal(input.loadKg, 16);
  assert.equal(input.clientRequestId, 'program-set:set1');
});

test('R08.5: a kettlebell program needs the weight, carries it in every set and offers the next preset', () => {
  assert.throws(
    () => buildProgramDraft({ ...baseInput, exerciseType: 'kettlebell_swing', baselineMaxReps: 15, targetReps: 30 }, clockOct),
    (e: unknown) => e instanceof ProgramError && e.status === 400 && e.code === 'PROGRAM_LOAD_REQUIRED',
  );
  const draft = buildProgramDraft(
    { ...baseInput, exerciseType: 'kettlebell_swing', loadKg: 16, baselineMaxReps: 15, targetReps: 30, startDate: '2026-10-12' },
    clockOct,
  );
  assert.equal(draft.clean.loadKg, 16);
  for (const s of draft.sessions) for (const st of s.sets) assert.equal(st.loadKg, 16);
  // presets of the swing: 12, 16, 20, 24, 28, 32
  assert.equal(nextKettlebellLoad('kettlebell_swing', 16), 20);
  assert.equal(nextKettlebellLoad('kettlebell_swing', 17), 20);
  assert.equal(nextKettlebellLoad('kettlebell_swing', 32), null);
  assert.equal(nextKettlebellLoad('pushups', 16), null);
  // a weight on a bodyweight exercise is ignored
  const plain = buildProgramDraft({ ...baseInput, loadKg: 16, startDate: '2026-10-12' }, clockOct);
  assert.equal(plain.clean.loadKg, null);
});

test('R08.6: distance plan — 3 sessions a week (easy, interval, long), weekly volume grows ≤ 10%, final test is X km', () => {
  const cases = [
    { baselineMeters: 1000, targetMeters: 5000 },
    { baselineMeters: 3000, targetMeters: 10000 },
    { baselineMeters: 4500, targetMeters: 5000 },
    { baselineMeters: 2000, targetMeters: 42195 },
    { baselineMeters: 20000, targetMeters: 100000 },
  ];
  for (const c of cases) {
    const plan = buildDistancePlan({ ...c, frequencyPerWeek: 3 });
    assert.ok(plan.weeks.length >= 4, `${c.targetMeters}: at least 4 weeks`);
    let prev: number | null = null;
    for (const week of plan.weeks) {
      assert.deepEqual(week.sessions.map((s) => s.kind), ['easy', 'interval', 'long']);
      const volume = week.sessions.reduce((sum, s) => sum + s.sets.reduce((a, st) => a + st.targetReps, 0), 0);
      assert.equal(volume, week.volumeMeters);
      if (prev != null) assert.ok(volume <= prev * 1.1, `${c.baselineMeters}→${c.targetMeters} week ${week.weekNumber}: ${volume} > 1.1 × ${prev}`);
      prev = volume;
    }
    assert.equal(plan.weeks[0].sessions[2].sets[0].targetReps, c.baselineMeters);
  }

  const draft = buildProgramDraft(
    { ...baseInput, exerciseType: 'run', baselineMaxReps: 3000, targetReps: 5000, frequencyPerWeek: 5, startDate: '2026-10-12' },
    clockOct,
  );
  assert.equal(draft.clean.frequencyPerWeek, 3);
  const training = draft.sessions.filter((s) => !s.isFinalTest);
  assert.deepEqual(training.slice(0, 3).map((s) => s.sessionKind), ['easy', 'interval', 'long']);
  const final = draft.sessions.at(-1);
  assert.equal(final?.isFinalTest, true);
  assert.deepEqual(final?.sets.map((s) => s.targetReps), [5000]);
  for (const s of draft.sessions) assert.equal(localHHMM(s.scheduledAt, MOSCOW), '19:00');
});

test('R08.6/safety: a distance target is never further than the plan grows to; further is a 400 with the limit', () => {
  // максимум недель тренировок 23 → рост длинной 1,1^22 ≈ 8,14; длинная доходит до 90% цели
  const naive = (base: number) => (base * 1.1 ** 22) / 0.9;
  for (const base of [200, 1000, 3000, 5000]) {
    const limit = distanceTargetLimit(base);
    assert.ok(limit <= naive(base), `${base}: limit ${limit} > ${naive(base)}`);
    assert.ok(limit >= naive(base) * 0.8, `${base}: limit ${limit} far below ${naive(base)}`); // округление длинной до 10 м
    // на пределе план и правда дорастает: последняя длинная — не меньше 90% цели (до 10 м)
    const plan = buildDistancePlan({ baselineMeters: base, targetMeters: limit, frequencyPerWeek: 3 });
    const lastLong = plan.weeks.at(-1)!.longMeters;
    assert.ok(lastLong >= Math.floor((limit * 0.9) / 10) * 10, `${base}→${limit}: last long ${lastLong}`);
    let prev: number | null = null;
    for (const week of plan.weeks) {
      if (prev != null) assert.ok(week.volumeMeters <= prev * 1.1, `${base}: week ${week.weekNumber} volume`);
      prev = week.volumeMeters;
    }
  }
  assert.equal(distanceTargetLimit(200000), 300000);

  // 1 км сейчас → 15 км без остановки: столько план не вырастит — 400 с пределом, а не тихий недобор
  assert.throws(
    () => buildProgramDraft({ ...baseInput, exerciseType: 'run', baselineMaxReps: 1000, targetReps: 15000, startDate: '2026-10-12' }, clockOct),
    (e: unknown) => e instanceof ProgramError && e.status === 400 && e.code === 'PROGRAM_DISTANCE_TOO_FAR'
      && e.details?.maxTargetMeters === distanceTargetLimit(1000) && /км/.test(e.message),
  );
  const ok = buildProgramDraft({ ...baseInput, exerciseType: 'run', baselineMaxReps: 1000, targetReps: 8000, startDate: '2026-10-12' }, clockOct);
  assert.deepEqual(ok.sessions.at(-1)?.sets.map((s) => s.targetReps), [8000]);
  const longs = ok.sessions.filter((s) => s.sessionKind === 'long').map((s) => s.sets[0].targetReps);
  assert.ok(longs.at(-1)! >= 7200, `last long ${longs.at(-1)}`);
});

test('R08.2: muscle-ups with a max of 0 do not start and suggest pull-ups and dips', () => {
  assert.throws(
    () => buildProgramDraft({ ...baseInput, exerciseType: 'muscle_ups', baselineMaxReps: 0, targetReps: 3 }, clockOct),
    (e: unknown) => e instanceof ProgramError && e.status === 400 && e.code === 'PROGRAM_BASELINE_ZERO',
  );
  assert.deepEqual(programStartAlternatives('muscle_ups', 0), ['pullups', 'dips']);
  assert.deepEqual(programStartAlternatives('muscle_ups', 2), []);
  assert.deepEqual(programStartAlternatives('pushups', 0), []);
  const ok = buildProgramDraft({ ...baseInput, exerciseType: 'muscle_ups', baselineMaxReps: 1, targetReps: 5, startDate: '2026-10-12' }, clockOct);
  assert.equal(ok.clean.exerciseType, 'muscle_ups');
});

test('API body: an unknown exercise type is a 400, never a silent push-up program', () => {
  const profile = { ageYears: 30, weightKg: 80, sex: 'male' };
  assert.throws(
    () => parseProgramCreateBody({ exerciseType: 'jumping_jacks', baselineMaxReps: 10, targetReps: 20 }, profile),
    (e: unknown) => e instanceof ProgramError && e.status === 400 && e.code === 'PROGRAM_EXERCISE_INVALID',
  );
  assert.throws(() => parseProgramCreateBody({ baselineMaxReps: 10, targetReps: 20 }, profile), ProgramError);
  const parsed = parseProgramCreateBody({ exerciseType: 'kettlebell_row', loadKg: '24', baselineMaxReps: 8, targetReps: 15 }, profile);
  assert.equal(parsed.exerciseType, 'kettlebell_row');
  assert.equal(parsed.loadKg, 24);
  assert.equal(parsed.weightKg, 80);
  // a 0 max reaches the muscle-up start rule instead of being turned into 1
  assert.equal(parseProgramCreateBody({ exerciseType: 'muscle_ups', baselineMaxReps: 0, targetReps: 3 }, profile).baselineMaxReps, 0);
});

test('R08.10: overdue sessions are closed by ordinary workouts only in programs without weight and not distance', () => {
  const clock = { now: new Date('2026-10-10T09:00:00Z'), timeZone: MOSCOW };
  const sessions = [{ id: 'overdue', scheduledAt: new Date('2026-10-07T16:00:00Z'), isFinalTest: false, sets: [{ id: 'a', targetReps: 10 }] }];
  const dayTotals = new Map([['2026-10-07', 30]]);
  const plan = (program: Parameters<typeof canAutofillProgram>[0]) => planOverdueAutofill({ sessions, dayTotals, clock, program });

  assert.deepEqual(plan({ exerciseType: 'pushups', programType: 'single', loadKg: null }).map((p) => p.sessionId), ['overdue']);
  assert.deepEqual(plan({ exerciseType: 'plank' }).map((p) => p.sessionId), ['overdue']);
  assert.deepEqual(plan({ exerciseType: 'kettlebell_swing', programType: 'single', loadKg: 16 }), []);
  assert.deepEqual(plan({ exerciseType: 'run', programType: 'single', loadKg: null }), []);
  assert.deepEqual(plan({ exerciseType: 'circuit', programType: 'circuit', loadKg: null }), []);
  assert.equal(canAutofillProgram({ exerciseType: 'kettlebell_jerk', loadKg: 16 }), false);
  assert.equal(canAutofillProgram({ exerciseType: 'dips' }), true);
});

test('a one-side set is matched to its workout by the sum of both sides', () => {
  const t0 = new Date('2026-10-10T16:00:00Z');
  const sets = [{ setNumber: 1, actualReps: 10, actualLeft: 10, actualRight: 12, completedAt: t0 }];
  // the set time was edited away, the sum of sides still matches
  assert.deepEqual(setsMissingWorkouts(sets, [{ time: new Date('2026-10-10T18:00:00Z'), reps: 22 }]), []);
  assert.deepEqual(setsMissingWorkouts(sets, [{ time: new Date('2026-10-10T18:00:00Z'), reps: 10 }]).map((s) => s.setNumber), [1]);
});

test('restored set workouts carry weight, sides, time and active calories', () => {
  const doneAt = new Date('2026-10-10T16:00:00Z');
  const rows = restoredSetWorkoutRows({
    sets: [
      { id: 'k1', setNumber: 1, actualReps: 8, actualLeft: 8, actualRight: 9, actualSeconds: null, loadKg: null, completedAt: doneAt },
    ],
    program: { userId: 'u1', exerciseType: 'kettlebell_press', loadKg: 16 },
    sessionId: 'sess',
    timeZone: MOSCOW,
    now: doneAt,
    body: { weightKg: 80 },
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].reps, 17);
  assert.equal(rows[0].repsLeft, 8);
  assert.equal(rows[0].repsRight, 9);
  assert.equal(rows[0].loadKg, 16);
  assert.equal(rows[0].clientRequestId, 'program-set:k1');
  assert.ok((rows[0].activeKcal ?? 0) > 0, 'active calories with a known weight');

  const run = restoredSetWorkoutRows({
    sets: [{ id: 'r1', setNumber: 1, actualReps: 5000, actualLeft: null, actualRight: null, actualSeconds: 1800, loadKg: null, completedAt: doneAt }],
    program: { userId: 'u1', exerciseType: 'run', loadKg: null },
    sessionId: 'sess',
    timeZone: MOSCOW,
    now: doneAt,
    body: { weightKg: null },
  });
  assert.equal(run[0].durationSeconds, 1800);
  assert.equal(run[0].activeKcal, null);
});

test('R08.9: program label for notifications, the calendar and lists', () => {
  assert.equal(programLabel({ exerciseType: 'pushups' }, 'ru'), 'Отжимания');
  assert.equal(programLabel({ exerciseType: 'kettlebell_swing', loadKg: 16 }, 'ru'), 'Махи гирей · 16 кг');
  assert.equal(programLabel({ exerciseType: 'kettlebell_press', loadKg: 12.5 }, 'en'), 'Kettlebell press · 12.5 kg');
  assert.equal(programLabel({ exerciseType: 'circuit', programType: 'circuit', circuitTitle: { ru: 'Дом, 3 раза в неделю', en: 'Home, 3 a week' } }, 'ru'), 'Круговая · Дом, 3 раза в неделю');
  assert.equal(programLabel({ exerciseType: 'circuit', programType: 'circuit' }, 'en'), 'Circuit');
});

test('R08.9: reminders and stop notices name the program by its label', async () => {
  const { programReminderMessage, programMissedMessage, programStoppedMessage } = await import('./notify');
  const at = new Date('2026-10-12T16:00:00Z');
  const reminder = programReminderMessage('ru', [{ id: 's1', exerciseType: 'kettlebell_swing', loadKg: 16, scheduledAt: at }], new Date('2026-10-12T15:40:00Z'));
  assert.match(reminder.body ?? '', /Махи гирей · 16 кг/);
  const missed = programMissedMessage('en', 'missed_1h', { sessionId: 's1', exerciseType: 'side_plank' });
  assert.match(missed.body ?? '', /Side plank/);
  const stopped = programStoppedMessage('ru', { programId: 'p1', exerciseType: 'kettlebell_press', loadKg: 12 });
  assert.match(stopped.body ?? '', /«Жим гири · 12 кг»/);
});

test('R09: program label finds the circuit plan title by circuitPlanId', () => {
  assert.equal(programLabel({ exerciseType: 'circuit', programType: 'circuit', circuitPlanId: 'home_three' }, 'ru'), 'Круговая · Дом, 3 раза в неделю');
  assert.equal(programLabel({ exerciseType: 'circuit', programType: 'circuit', circuitPlanId: 'kettlebells' }, 'en'), 'Circuit · Kettlebells');
  assert.equal(programLabel({ exerciseType: 'circuit', programType: 'circuit', circuitPlanId: 'gone' }, 'ru'), 'Круговая');
});

test('program-plan does not pull a database module into the client bundle', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const path = await import('node:path');
  const root = path.resolve(process.cwd(), 'src');
  const seen = new Set<string>();
  const offenders: string[] = [];
  const resolve = (from: string, spec: string) => {
    const base = spec.startsWith('@/') ? path.join(root, spec.slice(2)) : path.resolve(path.dirname(from), spec);
    for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) if (existsSync(cand) && cand.match(/\.tsx?$/)) return cand;
    return null;
  };
  const walk = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec === '@prisma/client' && !/import\s+type/.test(src.slice(Math.max(0, (m.index ?? 0) - 80), m.index))) offenders.push(`${file} → ${spec}`);
      if (!spec.startsWith('.') && !spec.startsWith('@/')) continue;
      if (/(^|\/)prisma$/.test(spec)) offenders.push(`${file} → ${spec}`);
      const next = resolve(file, spec);
      if (next) walk(next);
    }
  };
  walk(path.join(root, 'lib', 'program-plan.ts'));
  assert.deepEqual(offenders, []);
});

test('R09.3/R09.4/G01: circuit program — test circuit first, then rotation days with station/round/exercise sets', () => {
  const clock = { now: new Date('2026-10-24T09:00:00Z'), timeZone: MOSCOW };
  const draft = buildCircuitProgramDraft({ circuitPlanId: 'home_three', durationWeeks: 4, frequencyPerWeek: 3, startDate: '2026-10-26' }, clock);
  assert.equal(draft.clean.programType, 'circuit');
  assert.equal(draft.clean.exerciseType, 'circuit');
  assert.equal(draft.clean.circuitPlanId, 'home_three');
  assert.equal(draft.clean.durationWeeks, 4);
  assert.equal(draft.clean.frequencyPerWeek, 3);
  assert.equal(draft.sessions.length, 12);

  const [testSession, first] = draft.sessions;
  assert.equal(testSession.sessionKind, 'test');
  assert.equal(testSession.dayLabel, 'A');
  assert.equal(testSession.circuitTemplateId, 'home_full_body');
  assert.equal(testSession.day, '2026-10-26');
  assert.equal(testSession.scheduledAt.toISOString(), '2026-10-26T16:00:00.000Z');
  assert.deepEqual(testSession.sets.map((st) => st.exerciseType), ['squats', 'pushups', 'glute_bridge', 'australian_pullups', 'superman', 'side_plank']);
  assert.ok(testSession.sets.every((st) => st.round === 1 && st.restSeconds === 0));
  assert.deepEqual(testSession.sets.map((st) => st.station), [1, 2, 3, 4, 5, 6]);

  // дни по ротации после теста (тест — день A): B, C, A, B, C…
  assert.deepEqual(draft.sessions.map((s) => s.dayLabel).join(''), 'ABCABCABCABC');
  assert.deepEqual(draft.sessions.slice(0, 4).map((s) => s.day), ['2026-10-26', '2026-10-28', '2026-10-30', '2026-11-02']);
  assert.ok(draft.sessions.every((s) => !s.isFinalTest));

  // день B (home_cardio): 6 станций × 3 круга, отдых 15 с между станциями, 90 с между кругами
  assert.equal(first.circuitTemplateId, 'home_cardio');
  assert.equal(first.sessionKind ?? null, null);
  assert.equal(first.sets.length, 18);
  assert.deepEqual(first.sets.slice(0, 6).map((st) => st.restSeconds), [15, 15, 15, 15, 15, 90]);
  assert.equal(first.sets[17].restSeconds, 0);
  assert.deepEqual([first.sets[6].round, first.sets[6].station, first.sets[6].setNumber], [2, 1, 7]);
  // до теста — 70% целей шаблона: бёрпи 8 → 6, выпады 10/н → 7
  assert.equal(first.sets[0].targetReps, 6);
  assert.equal(first.sets[3].exerciseType, 'lunges');
  assert.equal(first.sets[3].targetReps, 7);

  // через неделю тот же день — цели выше
  const nextB = draft.sessions[4];
  assert.equal(nextB.dayLabel, 'B');
  assert.ok(nextB.sets[1].targetReps > first.sets[1].targetReps);
});

test('R09.3: circuit program body — plan is checked, 4–12 weeks, 2–4 a week; kettlebell days carry the weight', () => {
  const profile = { ageYears: 30, weightKg: 80, sex: 'male' };
  assert.equal(isCircuitProgramBody({ programType: 'circuit' }), true);
  assert.equal(isCircuitProgramBody({ exerciseType: 'pushups' }), false);
  const parsed = parseCircuitProgramCreateBody({ programType: 'circuit', circuitPlanId: 'kettlebells', durationWeeks: 30, frequencyPerWeek: 7 }, profile);
  assert.equal(parsed.circuitPlanId, 'kettlebells');
  assert.throws(
    () => parseCircuitProgramCreateBody({ programType: 'circuit', circuitPlanId: 'nope' }, profile),
    (e: unknown) => e instanceof ProgramError && e.code === 'CIRCUIT_PLAN_INVALID' && e.status === 400,
  );
  const draft = buildCircuitProgramDraft(parsed, { now: new Date('2026-10-24T09:00:00Z'), timeZone: MOSCOW });
  assert.equal(draft.clean.durationWeeks, 12);
  assert.equal(draft.clean.frequencyPerWeek, 4);
  assert.equal(draft.sessions.length, 48);
  const swing = draft.sessions[1].sets[0];
  assert.equal(swing.exerciseType, 'kettlebell_swing');
  assert.equal(swing.loadKg, 16);
});
