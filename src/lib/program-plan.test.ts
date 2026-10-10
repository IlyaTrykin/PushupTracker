import test from 'node:test';
import assert from 'node:assert/strict';
import { dayKeyInZone, localHHMM } from './calendar-day';
import {
  buildProgramDraft,
  evaluateProgramOutcome,
  isSessionOpenForSets,
  planOverdueAutofill,
  planProgramExtension,
  programReplacementScope,
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

test('a group assignment replaces only that group\'s program, never the personal one', () => {
  assert.deepEqual(programReplacementScope('pushups', 'group-1'), { exerciseType: 'pushups', managedByGroupId: 'group-1' });
  assert.deepEqual(programReplacementScope('pushups', null), { exerciseType: 'pushups', managedByGroupId: null });
  assert.deepEqual(programReplacementScope('pushups', undefined), { exerciseType: 'pushups', managedByGroupId: null });
});
