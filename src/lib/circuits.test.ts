import test from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES, type ExerciseType } from './exercises';
import { parseClientRequestId } from './workout-input';
import {
  CIRCUIT_EXCLUDED,
  CIRCUIT_PLANS,
  CIRCUIT_TEMPLATES,
  validateCircuit,
  progressCircuit,
  circuitWorkoutKey,
  type CircuitSpec,
  type CircuitStation,
} from './circuits';

function stations(...types: ExerciseType[]): CircuitStation[] {
  return types.map((exerciseType) => ({ exerciseType, target: 10 }));
}

function rulesAt(types: ExerciseType[]) {
  return validateCircuit({ stations: stations(...types) }).map((w) => `${w.rule}@${w.stationIndex}:${w.code}`);
}

// ---------------------------------------------------------------------------
// Правила сочетаемости (G02)
// ---------------------------------------------------------------------------

test('G02 rule 1: neighbouring stations of one primary group warn on the second station', () => {
  assert.deepEqual(rulesAt(['pushups', 'dips']), ['1@1:same_group', '3@1:press_in_row']);
  assert.deepEqual(rulesAt(['squats', 'pushups', 'lunges']), []);
  // правило 1 — только соседние станции, последняя и первая не соседи
  assert.deepEqual(rulesAt(['lunges', 'crunches', 'wall_sit']), []);
});

test('G02 rule 2: two grip exercises in a row', () => {
  assert.deepEqual(rulesAt(['pullups', 'kettlebell_swing']), ['2@1:grip_in_row']);
  assert.deepEqual(rulesAt(['squats', 'australian_pullups', 'hanging_leg_raises']), ['2@2:grip_in_row']);
});

test('G02 rule 3: two presses in a row (burpees count as a press)', () => {
  assert.deepEqual(rulesAt(['pushups', 'burpees']), ['3@1:press_in_row']);
  assert.deepEqual(rulesAt(['squats', 'kettlebell_press', 'burpees']), ['3@2:press_in_row']);
});

test('G02 rule 5: kettlebell swing further than the second station', () => {
  assert.deepEqual(rulesAt(['squats', 'kettlebell_swing']), []);
  assert.deepEqual(rulesAt(['squats', 'pushups', 'kettlebell_swing']), ['5@2:swing_late']);
});

test('G02 rule 6: more than two jumps in a row, or a jump right after wall sit / lunges', () => {
  assert.ok(rulesAt(['jump_rope', 'burpees', 'jump_rope']).includes('6@2:jumps_in_row'));
  assert.ok(!rulesAt(['jump_rope', 'burpees']).some((w) => w.startsWith('6@')));
  assert.deepEqual(rulesAt(['lunges', 'jump_rope']), ['6@1:jump_after_legs']);
  assert.deepEqual(rulesAt(['wall_sit', 'burpees']), ['6@1:jump_after_legs']);
  assert.deepEqual(rulesAt(['squats', 'pushups', 'jump_rope']), []);
});

test('G02 rule 7: two static holds in a row', () => {
  assert.deepEqual(rulesAt(['plank', 'wall_sit']), ['7@1:static_in_row']);
  assert.deepEqual(rulesAt(['side_plank', 'squats', 'plank']), []);
});

// ---------------------------------------------------------------------------
// Шаблоны и программы-ротации (R09, G01, G02.1, G04)
// ---------------------------------------------------------------------------

// Состав — из spec «Шаблоны (10)»: [упражнение, цель, вес гири].
const SPEC_TEMPLATES: Record<string, { stations: Array<[ExerciseType, number, number?]>; rounds: number; rest: [number, number] }> = {
  home_full_body: {
    stations: [['squats', 15], ['pushups', 10], ['glute_bridge', 15], ['australian_pullups', 8], ['superman', 12], ['side_plank', 20]],
    rounds: 3, rest: [20, 90],
  },
  home_cardio: {
    stations: [['burpees', 8], ['squats', 15], ['crunches', 15], ['lunges', 10], ['mountain_climbers', 20], ['plank', 30]],
    rounds: 3, rest: [15, 90],
  },
  home_no_jumps: {
    stations: [['squats', 15], ['pushups', 10], ['mountain_climbers', 20], ['glute_bridge', 15], ['crunches', 15], ['superman', 12], ['plank', 30]],
    rounds: 3, rest: [20, 90],
  },
  home_core_legs: {
    stations: [['lunges', 10], ['crunches', 15], ['glute_bridge', 15], ['side_plank', 20], ['squats', 15], ['superman', 12], ['wall_sit', 30]],
    rounds: 3, rest: [20, 90],
  },
  jump_rope: {
    stations: [['jump_rope', 50], ['squats', 15], ['pushups', 10], ['jump_rope', 50], ['crunches', 15]],
    rounds: 3, rest: [20, 90],
  },
  bar_and_dips: {
    stations: [['pullups', 5], ['squats', 15], ['dips', 8], ['lunges', 10], ['crunches', 15]],
    rounds: 3, rest: [30, 120],
  },
  core: {
    stations: [['crunches', 15], ['side_plank', 20], ['superman', 12], ['hanging_leg_raises', 8], ['glute_bridge', 15], ['plank', 30]],
    rounds: 3, rest: [20, 90],
  },
  kettlebell: {
    stations: [['kettlebell_swing', 15, 16], ['pushups', 10], ['squats', 15], ['kettlebell_press', 8, 12], ['plank', 30]],
    rounds: 3, rest: [30, 120],
  },
  kettlebell_full_body: {
    stations: [['kettlebell_swing', 15, 16], ['kettlebell_press', 6, 12], ['squats', 15], ['kettlebell_row', 8, 16], ['lunges', 8], ['superman', 12]],
    rounds: 3, rest: [30, 120],
  },
  run_and_strength: {
    stations: [['run', 400], ['pushups', 10], ['run', 400], ['squats', 15], ['crunches', 15]],
    rounds: 3, rest: [30, 120],
  },
};

test('R09: ten templates with exactly the composition of the spec', () => {
  assert.deepEqual(CIRCUIT_TEMPLATES.map((t) => t.id).sort(), Object.keys(SPEC_TEMPLATES).sort());
  for (const template of CIRCUIT_TEMPLATES) {
    const expected = SPEC_TEMPLATES[template.id];
    assert.deepEqual(
      template.stations.map((s) => [s.exerciseType, s.target, s.loadKg ?? undefined]),
      expected.stations.map(([type, target, kg]) => [type, target, kg]),
      template.id,
    );
    assert.equal(template.rounds, expected.rounds, template.id);
    assert.deepEqual([template.restStationSec, template.restRoundSec], expected.rest, template.id);
    assert.ok(template.title.ru && template.title.en, template.id);
    assert.ok(template.equipment.length > 0, template.id);
  }
});

test('G02.1: no template breaks a compatibility rule', () => {
  for (const template of CIRCUIT_TEMPLATES) {
    assert.deepEqual(validateCircuit(template), [], template.id);
  }
});

test('G04: muscle-ups and kettlebell jerk are excluded from templates and plans', () => {
  assert.deepEqual([...CIRCUIT_EXCLUDED].sort(), ['kettlebell_jerk', 'muscle_ups']);
  for (const template of CIRCUIT_TEMPLATES) {
    for (const st of template.stations) {
      assert.ok(!CIRCUIT_EXCLUDED.includes(st.exerciseType), `${template.id}: ${st.exerciseType}`);
      assert.ok(!EXERCISES[st.exerciseType].tags.includes('technical'), `${template.id}: ${st.exerciseType}`);
    }
  }
});

test('G01: five rotation plans with different templates on days A/B/C, each day passes the rules', () => {
  const byId = new Map(CIRCUIT_TEMPLATES.map((t) => [t.id, t]));
  assert.deepEqual(
    CIRCUIT_PLANS.map((p) => p.days.map((d) => `${d.label}:${d.templateId}`).join(' ')),
    [
      'A:home_full_body B:home_cardio C:home_core_legs',
      'A:home_no_jumps B:home_full_body',
      'A:bar_and_dips B:core',
      'A:kettlebell B:kettlebell_full_body',
      'A:run_and_strength B:home_full_body',
    ],
  );
  assert.equal(new Set(CIRCUIT_PLANS.map((p) => p.id)).size, 5);
  for (const plan of CIRCUIT_PLANS) {
    assert.ok(plan.title.ru && plan.title.en, plan.id);
    assert.equal(new Set(plan.days.map((d) => d.templateId)).size, plan.days.length, `${plan.id}: days differ`);
    for (const day of plan.days) {
      const template = byId.get(day.templateId);
      assert.ok(template, `${plan.id}/${day.label}`);
      assert.deepEqual(validateCircuit(template), [], `${plan.id}/${day.label}`);
      assert.ok(template.stations.every((s) => !CIRCUIT_EXCLUDED.includes(s.exerciseType)), `${plan.id}/${day.label}`);
    }
  }
  assert.equal(CIRCUIT_PLANS[0].title.ru, 'Дом, 3 раза в неделю');
});

// ---------------------------------------------------------------------------
// Прогрессия (R09.5)
// ---------------------------------------------------------------------------

function spec(list: Array<[ExerciseType, number]>, rounds = 3): CircuitSpec {
  return { stations: list.map(([exerciseType, target]) => ({ exerciseType, target })), rounds, restStationSec: 20, restRoundSec: 90 };
}

test('R09.5: week 1 is the base, then targets grow about 10% a week', () => {
  const base = spec([['pushups', 20], ['squats', 30], ['plank', 40]]);
  assert.deepEqual(progressCircuit(base, 1), base);
  const week2 = progressCircuit(base, 2);
  assert.deepEqual(week2.stations.map((s) => s.target), [22, 33, 44]);
  assert.equal(week2.rounds, 3);
  const week3 = progressCircuit(base, 3);
  assert.deepEqual(week3.stations.map((s) => s.target), [24, 36, 48]);
  assert.equal(week3.restStationSec, 20);
  assert.equal(week3.restRoundSec, 90);
});

test('R09.5: targets stop at the ceilings — reps 50, jump rope 150, seconds 120, metres 800', () => {
  const at = (type: ExerciseType, target: number) => progressCircuit(spec([[type, target]], 5), 20).stations[0].target;
  assert.equal(at('pushups', 40), 50);
  assert.equal(at('jump_rope', 100), 150);
  assert.equal(at('plank', 90), 120);
  assert.equal(at('run', 600), 800);
  // цель выше потолка не снижается
  assert.equal(at('pushups', 70), 70);
});

test('R09.5: at the ceiling a round is added, never more than 5', () => {
  const base = spec([['pushups', 40], ['squats', 20]]);
  const week3 = progressCircuit(base, 3); // 40 × 1.21 = 48.4 — ещё под потолком
  assert.equal(week3.rounds, 3);
  const week4 = progressCircuit(base, 4); // 40 × 1.331 > 50 → +1 круг
  assert.equal(week4.rounds, 4);
  assert.ok(week4.stations[0].target <= 50);
  for (let week = 1; week <= 40; week += 1) {
    const s = progressCircuit(base, week);
    assert.ok(s.rounds <= 5, `week ${week}`);
    assert.ok(s.stations[0].target <= 50, `week ${week}`);
  }
  assert.equal(progressCircuit(base, 40).rounds, 5);
  // объём не падает от недели к неделе
  const volume = (s: CircuitSpec) => s.rounds * s.stations.reduce((sum, st) => sum + st.target, 0);
  for (let week = 2; week <= 12; week += 1) {
    assert.ok(volume(progressCircuit(base, week)) >= volume(progressCircuit(base, week - 1)) - 2, `week ${week}`);
  }
});

// ---------------------------------------------------------------------------
// Ключ тренировки станции (R09.1)
// ---------------------------------------------------------------------------

test('R09.1: every station of a run is its own workout key, valid as clientRequestId', () => {
  const runId = '0b7f3c1e-5a4d-4c2b-9e8f-1a2b3c4d5e6f';
  assert.equal(circuitWorkoutKey(runId, 2, 5), `circuit:${runId}:2:5`);
  assert.notEqual(circuitWorkoutKey(runId, 1, 2), circuitWorkoutKey(runId, 2, 1));
  const parsed = parseClientRequestId(circuitWorkoutKey(runId, 5, 10));
  assert.equal(parsed.ok, true);
});

// ---------------------------------------------------------------------------
// Цели от тест-круга (R09.4)
// ---------------------------------------------------------------------------

test('R09.4: the test is one round without rest; start targets are 70% of each station result', async () => {
  const { circuitTestSpec, circuitStartSpec, getCircuitTemplate } = await import('./circuits');
  const a = getCircuitTemplate('home_full_body')!;
  const testSpec = circuitTestSpec(a);
  assert.equal(testSpec.rounds, 1);
  assert.equal(testSpec.restStationSec, 0);
  assert.equal(testSpec.restRoundSec, 0);
  assert.deepEqual(testSpec.stations.map((s) => s.exerciseType), a.stations.map((s) => s.exerciseType));

  // приседания 30, отжимания 20, мост 30, австралийские 10, супермен 20, боковая планка 40 с (всё ≤ 2× ориентира)
  const results = [30, 20, 30, 10, 20, 40].map((actual, i) => ({ exerciseType: a.stations[i].exerciseType, target: a.stations[i].target, actual }));
  const start = circuitStartSpec(a, results);
  assert.deepEqual(start.stations.map((s) => s.target), [21, 14, 21, 7, 14, 28]);
  assert.equal(start.rounds, 3);

  // день B: приседания — из теста (30 → 21), остальное — цель шаблона × средняя доля теста
  const b = getCircuitTemplate('home_cardio')!;
  const startB = circuitStartSpec(b, results);
  assert.equal(startB.stations[1].exerciseType, 'squats');
  assert.equal(startB.stations[1].target, 21);
  // средняя доля: (30/15 + 20/10 + 30/15 + 10/8 + 20/12 + 40/20) / 6 ≈ 1.82 → бёрпи 8 × 1.82 × 0.7 ≈ 10
  assert.equal(startB.stations[0].target, 10);

  // без теста — 70% целей шаблона
  assert.deepEqual(circuitStartSpec(a).stations.map((s) => s.target), [11, 7, 11, 6, 8, 14]);
});

test('G04/R09.4: a typo in the test round («1000 squats», «4000 m» instead of 400) never becomes a harmful start target', async () => {
  const { circuitStartSpec, circuitTargetCeiling, getCircuitTemplate, planCircuitSession } = await import('./circuits');
  const a = getCircuitTemplate('home_full_body')!;
  // приседания: ориентир 15, опечатка 1000 → результат не больше 2 × 15 = 30 → старт 70% = 21
  const typo = [1000, 20, 30, 10, 20, 40].map((actual, i) => ({ exerciseType: a.stations[i].exerciseType, target: a.stations[i].target, actual }));
  const start = circuitStartSpec(a, typo);
  assert.equal(start.stations[0].target, 21);
  assert.equal(start.stations[1].target, 14);

  // бег: ориентир 400 м, опечатка 4000 м → не больше 2 × 400 = 800 м (и потолка 800) → старт 560 м
  const run = getCircuitTemplate('run_and_strength')!;
  const runTypo = [4000, 20, 400, 30, 30].map((actual, i) => ({ exerciseType: run.stations[i].exerciseType, target: run.stations[i].target, actual }));
  const runStart = circuitStartSpec(run, runTypo);
  assert.equal(runStart.stations[0].target, 560);
  assert.equal(runStart.stations[2].target, 560);

  // на любом дне ротации стартовая цель станции не выше потолка, даже при абсурдном тесте
  const absurd = CIRCUIT_TEMPLATES.flatMap((t) => t.stations).map((s) => ({ exerciseType: s.exerciseType, target: s.target, actual: 100000 }));
  for (const template of CIRCUIT_TEMPLATES) {
    const sets = planCircuitSession(template.id, 1, absurd)!;
    for (const set of sets) {
      assert.ok(set.targetReps <= circuitTargetCeiling(set.exerciseType), `${template.id}/${set.exerciseType}: ${set.targetReps}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Свой круг (R09.2, G04)
// ---------------------------------------------------------------------------

test('R09.2/G04: own circuit — excluded exercises, too many stations and missing weight are rejected', async () => {
  const { parseCustomCircuitInput, CircuitError } = await import('./circuits');
  const ok = parseCustomCircuitInput({
    title: '  Утро ',
    stations: [{ exerciseType: 'squats', target: 20 }, { exerciseType: 'kettlebell_swing', target: 15, loadKg: 16 }],
    rounds: 3,
    restStationSec: 20,
    restRoundSec: 90,
  });
  assert.equal(ok.title, 'Утро');
  assert.deepEqual(ok.stations, [{ exerciseType: 'squats', target: 20 }, { exerciseType: 'kettlebell_swing', target: 15, loadKg: 16 }]);

  const code = (body: unknown) => {
    try {
      parseCustomCircuitInput(body);
      return 'ok';
    } catch (e) {
      assert.ok(e instanceof CircuitError);
      assert.equal(e.status, 400);
      return e.code;
    }
  };
  const base = { title: 'x', rounds: 3, restStationSec: 20, restRoundSec: 90 };
  assert.equal(code({ ...base, stations: [{ exerciseType: 'muscle_ups', target: 3 }] }), 'CIRCUIT_EXERCISE_EXCLUDED');
  assert.equal(code({ ...base, stations: [{ exerciseType: 'kettlebell_jerk', target: 5, loadKg: 16 }] }), 'CIRCUIT_EXERCISE_EXCLUDED');
  assert.equal(code({ ...base, stations: Array.from({ length: 11 }, () => ({ exerciseType: 'squats', target: 10 })) }), 'CIRCUIT_TOO_MANY_STATIONS');
  assert.equal(code({ ...base, stations: Array.from({ length: 10 }, () => ({ exerciseType: 'squats', target: 10 })) }), 'ok');
  assert.equal(code({ ...base, stations: [{ exerciseType: 'kettlebell_row', target: 8 }] }), 'CIRCUIT_LOAD_REQUIRED');
  assert.equal(code({ ...base, stations: [{ exerciseType: 'nope', target: 8 }] }), 'CIRCUIT_EXERCISE_INVALID');
  assert.equal(code({ ...base, stations: [] }), 'CIRCUIT_STATIONS_INVALID');
  assert.equal(code({ ...base, title: '', stations: [{ exerciseType: 'squats', target: 10 }] }), 'CIRCUIT_TITLE_INVALID');
  assert.equal(code({ ...base, rounds: 0, stations: [{ exerciseType: 'squats', target: 10 }] }), 'CIRCUIT_ROUNDS_INVALID');
  // частичная правка берёт недостающее из текущего круга
  assert.equal(parseCustomCircuitInput({ rounds: 5 }, ok).stations.length, 2);
});
