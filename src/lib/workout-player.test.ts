import assert from 'node:assert/strict';
import test from 'node:test';
import { getCircuitTemplate, type CircuitSpec } from './circuits';
import {
  WARMUP_SECONDS,
  circuitRunSteps,
  circuitStationPayload,
  newCircuitRun,
  parseCircuitRun,
  programSessionSteps,
  programSetBody,
  resumeStepIndex,
  upcomingExercise,
  type PlayerStep,
} from './workout-player';

const pushupSets = [
  { id: 's1', setNumber: 1, targetReps: 12, restSeconds: 90 },
  { id: 's2', setNumber: 2, targetReps: 14, restSeconds: 120 },
  { id: 's3', setNumber: 3, targetReps: 20, restSeconds: 0 },
];

function kinds(steps: PlayerStep[]): string {
  return steps.map((s) => (s.kind === 'rest' ? `rest${s.seconds}` : s.kind === 'warmup' ? 'warmup' : `${s.exerciseType}:${s.target}`)).join(' ');
}

test('a usual program session: set, rest, set … — no warm-up and no rest after the last set', () => {
  const steps = programSessionSteps({ exerciseType: 'pushups', sets: pushupSets });
  assert.equal(kinds(steps), 'pushups:12 rest90 pushups:14 rest120 pushups:20');
  assert.deepEqual(steps.filter((s) => s.kind === 'exercise').map((s) => s.setId), ['s1', 's2', 's3']);
});

test('a kettlebell, a one-side and a distance program carry weight, sides and units into the steps', () => {
  const kb = programSessionSteps({ exerciseType: 'kettlebell_press', loadKg: 16, sets: [{ id: 'k1', setNumber: 1, targetReps: 8, restSeconds: 0 }] });
  assert.equal(kb[0].loadKg, 16);
  assert.equal(kb[0].perSide, true); // жим гири — на каждую руку
  const run = programSessionSteps({ exerciseType: 'run', sets: [{ id: 'r1', setNumber: 1, targetReps: 3000, restSeconds: 0 }] });
  assert.equal(run[0].perSide, false);
  assert.equal(run[0].target, 3000);
});

test('a circuit program session starts with a skippable warm-up; stations keep their own exercise, weight, round and station', () => {
  const steps = programSessionSteps({
    exerciseType: 'circuit',
    programType: 'circuit',
    sets: [
      { id: 'a', setNumber: 1, targetReps: 15, restSeconds: 30, exerciseType: 'kettlebell_swing', loadKg: 16, round: 1, station: 1 },
      { id: 'b', setNumber: 2, targetReps: 10, restSeconds: 120, exerciseType: 'pushups', round: 1, station: 2 },
      { id: 'c', setNumber: 3, targetReps: 15, restSeconds: 30, exerciseType: 'kettlebell_swing', loadKg: 16, round: 2, station: 1 },
      { id: 'd', setNumber: 4, targetReps: 10, restSeconds: 0, exerciseType: 'pushups', round: 2, station: 2 },
    ],
  });
  assert.equal(steps[0].kind, 'warmup');
  assert.equal(steps[0].seconds, WARMUP_SECONDS);
  assert.ok(WARMUP_SECONDS >= 180 && WARMUP_SECONDS <= 300, 'разминка 3–5 минут');
  assert.equal(kinds(steps.slice(1)), 'kettlebell_swing:15 rest30 pushups:10 rest120 kettlebell_swing:15 rest30 pushups:10');
  const swing = steps[1];
  assert.equal(swing.loadKg, 16);
  assert.equal(swing.round, 1);
  assert.equal(swing.station, 1);
  assert.equal(swing.rounds, 2);
  assert.equal(swing.stations, 2);
});

test('a test circuit (no rest between stations) has no zero-second rests', () => {
  const steps = programSessionSteps({
    exerciseType: 'circuit',
    programType: 'circuit',
    sets: [
      { id: 'a', setNumber: 1, targetReps: 15, restSeconds: 0, exerciseType: 'squats', round: 1, station: 1 },
      { id: 'b', setNumber: 2, targetReps: 10, restSeconds: 0, exerciseType: 'pushups', round: 1, station: 2 },
    ],
  });
  assert.equal(kinds(steps), 'warmup squats:15 pushups:10');
});

test('a one-off circuit: warm-up, then the template round by round with station and round rests', () => {
  const template = getCircuitTemplate('home_full_body');
  assert.ok(template);
  const steps = circuitRunSteps(template);
  const exercises = steps.filter((s) => s.kind === 'exercise');
  assert.equal(steps[0].kind, 'warmup');
  assert.equal(exercises.length, 18); // 6 станций × 3 круга
  // После 6-й станции 1-го круга — отдых между кругами (90 с), после последней станции — ничего.
  const sixth = steps.findIndex((s) => s.kind === 'exercise' && s.round === 1 && s.station === 6);
  assert.equal(steps[sixth + 1].kind, 'rest');
  assert.equal(steps[sixth + 1].seconds, 90);
  assert.equal(steps[1].exerciseType, 'squats');
  assert.equal(steps[2].seconds, 20);
  assert.equal(steps[steps.length - 1].kind, 'exercise');
  // Боковая планка — секунды на каждую сторону.
  const sidePlank = exercises.find((s) => s.exerciseType === 'side_plank');
  assert.equal(sidePlank?.perSide, true);
  assert.equal(sidePlank?.target, 20);
});

test('resume: the first step not done; the warm-up is not repeated once anything is done', () => {
  const steps = programSessionSteps({
    exerciseType: 'circuit',
    programType: 'circuit',
    sets: [
      { id: 'a', setNumber: 1, targetReps: 15, restSeconds: 20, exerciseType: 'squats', round: 1, station: 1 },
      { id: 'b', setNumber: 2, targetReps: 10, restSeconds: 20, exerciseType: 'pushups', round: 1, station: 2 },
      { id: 'c', setNumber: 3, targetReps: 15, restSeconds: 0, exerciseType: 'glute_bridge', round: 1, station: 3 },
    ],
  });
  assert.equal(resumeStepIndex(steps, new Set()), 0); // ничего не сделано — с разминки
  assert.equal(resumeStepIndex(steps, new Set(), { warmupDone: true }), 1); // разминку прошли/пропустили
  const afterFirst = resumeStepIndex(steps, new Set([steps[1].id]));
  assert.equal(steps[afterFirst].kind, 'exercise'); // не с отдыха — сразу следующая станция
  assert.equal(steps[afterFirst].exerciseType, 'pushups');
  const allDone = new Set(steps.filter((s) => s.kind === 'exercise').map((s) => s.id));
  assert.equal(resumeStepIndex(steps, allDone), steps.length);
});

test('the next exercise is known in advance (from an exercise and from a rest)', () => {
  const steps = programSessionSteps({ exerciseType: 'pushups', sets: pushupSets });
  assert.equal(upcomingExercise(steps, 0)?.target, 14);
  assert.equal(upcomingExercise(steps, 1)?.target, 14);
  assert.equal(upcomingExercise(steps, 4), null);
});

test('a program set body by kind: reps, both sides, metres with optional time', () => {
  const [reps] = programSessionSteps({ exerciseType: 'pushups', sets: [pushupSets[0]] });
  assert.deepEqual(programSetBody(reps, { value: 11 }), { actualReps: 11 });
  assert.equal(programSetBody(reps, { value: 0 }), null);

  const [lunges] = programSessionSteps({ exerciseType: 'lunges', sets: [{ id: 'l', setNumber: 1, targetReps: 10, restSeconds: 0 }] });
  assert.deepEqual(programSetBody(lunges, { left: 10, right: 9 }), { actualLeft: 10, actualRight: 9 });
  assert.equal(programSetBody(lunges, { left: 0, right: 0 }), null);

  const [run] = programSessionSteps({ exerciseType: 'run', sets: [{ id: 'r', setNumber: 1, targetReps: 3000, restSeconds: 0 }] });
  assert.deepEqual(programSetBody(run, { value: 3200, seconds: 1080 }), { actualReps: 3200, actualSeconds: 1080 });
  assert.deepEqual(programSetBody(run, { value: 3200 }), { actualReps: 3200 });
  assert.equal(programSetBody(run, { value: 5 }), null); // дистанция — от 10 м
});

test('a station of a one-off circuit becomes a workout with the key circuit:<runId>:<round>:<station>', () => {
  const spec: CircuitSpec = { stations: [{ exerciseType: 'kettlebell_row', target: 8, loadKg: 16 }, { exerciseType: 'run', target: 400 }], rounds: 2, restStationSec: 30, restRoundSec: 120 };
  const steps = circuitRunSteps(spec);
  const row = steps.find((s) => s.kind === 'exercise' && s.round === 2 && s.station === 1);
  assert.ok(row);
  const now = new Date('2026-10-24T21:30:00Z'); // в Москве уже 25-е
  const payload = circuitStationPayload({ runId: 'run1', step: row, result: { left: 8, right: 7 }, now, timeZone: 'Europe/Moscow' });
  assert.deepEqual(payload, {
    exerciseType: 'kettlebell_row',
    reps: 15,
    repsLeft: 8,
    repsRight: 7,
    loadKg: 16,
    date: '2026-10-25',
    time: '2026-10-24T21:30:00.000Z',
    clientRequestId: 'circuit:run1:2:1',
  });

  const run = steps.find((s) => s.kind === 'exercise' && s.round === 1 && s.station === 2);
  assert.ok(run);
  assert.deepEqual(circuitStationPayload({ runId: 'run1', step: run, result: { value: 420, seconds: 95 }, now, timeZone: 'UTC' }), {
    exerciseType: 'run',
    reps: 420,
    durationSeconds: 95,
    date: '2026-10-24',
    time: '2026-10-24T21:30:00.000Z',
    clientRequestId: 'circuit:run1:1:2',
  });
  assert.equal(circuitStationPayload({ runId: 'run1', step: run, result: { value: 0 }, now, timeZone: 'UTC' }), null);
});

test('a stored one-off run survives a restart and a broken record is dropped', () => {
  const template = getCircuitTemplate('kettlebell');
  assert.ok(template);
  const run = newCircuitRun({ runId: 'r-1', title: 'Гири', templateId: 'kettlebell', spec: template, now: new Date('2026-10-24T10:00:00Z') });
  const stored = JSON.parse(JSON.stringify({ ...run, done: ['st:1:1'] }));
  const back = parseCircuitRun(stored);
  assert.ok(back);
  assert.equal(back.runId, 'r-1');
  assert.deepEqual(back.done, ['st:1:1']);
  assert.equal(back.spec.stations[0].loadKg, 16);
  assert.equal(resumeStepIndex(circuitRunSteps(back.spec), new Set(back.done)), 3); // разминка, мах, отдых → отжимания
  assert.equal(parseCircuitRun({ runId: 'x', spec: { stations: [{ exerciseType: 'muscle_ups', target: 3 }], rounds: 1, restStationSec: 0, restRoundSec: 0 } }), null);
  assert.equal(parseCircuitRun('garbage'), null);
  assert.equal(parseCircuitRun(null), null);
});
