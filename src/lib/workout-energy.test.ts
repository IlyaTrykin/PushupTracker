import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import {
  createEnergyBackfill,
  editedWorkoutEnergy,
  hideForeignEnergy,
  planEnergyBackfill,
  toBodyMetrics,
  weightAppeared,
  weightAt,
  workoutActiveKcal,
  type EnergyBackfillDeps,
  type EnergyBodyRow,
  type EnergyWorkoutRow,
  type WeightHistoryRow,
} from './workout-energy';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);
const at = (iso: string) => new Date(iso);

// 60 отжиманий = 120 с при 2 с/повтор, MET 7.5: (7.5 − 1) × вес × 120/3600 → 80 кг: 17.3, 90 кг: 19.5.
const KCAL_60_PUSHUPS = { 80: 17.3, 90: 19.5 } as const;

test('toBodyMetrics: a DB user row becomes calculator input (date of birth as a day, known sex only)', () => {
  assert.deepEqual(toBodyMetrics({ weightKg: 80, heightCm: 180, birthDate: day('1990-05-01'), gender: 'female' }), {
    weightKg: 80,
    heightCm: 180,
    birthDate: '1990-05-01',
    sex: 'female',
  });
  assert.deepEqual(toBodyMetrics({ weightKg: null, heightCm: null, birthDate: null, gender: 'unknown' }), {
    weightKg: null,
    heightCm: null,
    birthDate: null,
    sex: null,
  });
  assert.deepEqual(toBodyMetrics(null), { weightKg: null, heightCm: null, birthDate: null, sex: null });
});

test('workoutActiveKcal: by the body at hand; without weight — null', () => {
  const w = { exerciseType: 'pushups', reps: 60, date: day('2026-10-19') };
  assert.equal(workoutActiveKcal(w, { weightKg: 80 }), KCAL_60_PUSHUPS[80]);
  assert.equal(workoutActiveKcal(w, { weightKg: null }), null);
});

const HISTORY: WeightHistoryRow[] = [
  { changedAt: at('2026-10-05T10:00:00Z'), changes: { username: { from: 'a', to: 'b' } } },
  { changedAt: at('2026-10-10T10:00:00Z'), changes: { weightKg: { from: null, to: 80 } } },
  { changedAt: at('2026-10-15T10:00:00Z'), changes: { weightKg: { from: 80, to: '90' }, heightCm: { from: null, to: 180 } } },
];

test('weightAt: the weight in force at that moment, from the profile history', () => {
  assert.equal(weightAt(HISTORY, at('2026-10-12T08:00:00Z'), 95), 80);
  assert.equal(weightAt(HISTORY, at('2026-10-16T08:00:00Z'), 95), 90);
  // До первого веса — первый известный вес, а не текущий.
  assert.equal(weightAt(HISTORY, at('2026-10-01T08:00:00Z'), 95), 80);
  // Истории веса нет — текущий.
  assert.equal(weightAt([], at('2026-10-01T08:00:00Z'), 95), 95);
  assert.equal(weightAt(HISTORY.slice(0, 1), at('2026-10-12T08:00:00Z'), 95), 95);
});

test('planEnergyBackfill: each workout gets calories by the weight of its date', () => {
  const workouts: EnergyWorkoutRow[] = [
    { id: 'old', exerciseType: 'pushups', reps: 60, date: day('2026-10-12'), time: at('2026-10-12T08:00:00Z') },
    { id: 'new', exerciseType: 'pushups', reps: 60, date: day('2026-10-16'), time: at('2026-10-16T08:00:00Z') },
  ];
  assert.deepEqual(planEnergyBackfill(workouts, { weightKg: 95 }, HISTORY), [
    { id: 'old', activeKcal: KCAL_60_PUSHUPS[80] },
    { id: 'new', activeKcal: KCAL_60_PUSHUPS[90] },
  ]);
  assert.deepEqual(planEnergyBackfill(workouts, { weightKg: null }, []), []);
});

/** In-memory workouts and the profile; saveEnergy writes only where activeKcal is still empty. */
function fakeStore(body: EnergyBodyRow | null, history: WeightHistoryRow[], rows: Array<EnergyWorkoutRow & { userId: string; activeKcal: number | null }>) {
  const calls = { loadWorkouts: 0 };
  const deps: EnergyBackfillDeps = {
    loadBody: async () => body,
    loadWeightHistory: async () => history,
    loadWorkoutsWithoutEnergy: async (userId, afterId, take) => {
      calls.loadWorkouts += 1;
      return rows
        .filter((r) => r.userId === userId && r.activeKcal === null && (afterId === null || r.id > afterId))
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, take);
    },
    saveEnergy: async (updates) => {
      let n = 0;
      for (const u of updates) {
        const row = rows.find((r) => r.id === u.id);
        if (row && row.activeKcal === null) {
          row.activeKcal = u.activeKcal;
          n += 1;
        }
      }
      return n;
    },
  };
  return { deps, rows, calls };
}

function workoutRows() {
  return [
    { id: 'a1', userId: 'u1', exerciseType: 'pushups', reps: 60, date: day('2026-10-12'), time: at('2026-10-12T08:00:00Z'), activeKcal: null },
    { id: 'a2', userId: 'u1', exerciseType: 'pushups', reps: 60, date: day('2026-10-16'), time: at('2026-10-16T08:00:00Z'), activeKcal: null },
    { id: 'a3', userId: 'u1', exerciseType: 'pushups', reps: 60, date: day('2026-10-16'), time: at('2026-10-16T09:00:00Z'), activeKcal: 5 },
    { id: 'a4', userId: 'u1', exerciseType: 'run', reps: 5000, durationSeconds: 1800, date: day('2026-10-17'), time: at('2026-10-17T09:00:00Z'), activeKcal: null },
    { id: 'b1', userId: 'u2', exerciseType: 'pushups', reps: 60, date: day('2026-10-16'), time: at('2026-10-16T08:00:00Z'), activeKcal: null },
  ];
}

test('backfillWorkoutEnergy: fills only empty calories of this user, by the weight of the date; a second run changes nothing', async () => {
  const { deps, rows } = fakeStore({ weightKg: 95 }, HISTORY, workoutRows());
  const backfill = createEnergyBackfill(deps);

  const first = await backfill('u1', { batchSize: 2 });
  assert.deepEqual(first, { pending: 3, updated: 3 });
  const byId = Object.fromEntries(rows.map((r) => [r.id, r.activeKcal]));
  assert.equal(byId.a1, KCAL_60_PUSHUPS[80]);
  assert.equal(byId.a2, KCAL_60_PUSHUPS[90]);
  assert.equal(byId.a3, 5, 'stored calories are never recalculated');
  assert.ok(byId.a4 !== null && byId.a4 > 300);
  assert.equal(byId.b1, null, 'another user is untouched');

  const snapshot = rows.map((r) => r.activeKcal);
  assert.deepEqual(await backfill('u1', { batchSize: 2 }), { pending: 0, updated: 0 });
  assert.deepEqual(rows.map((r) => r.activeKcal), snapshot);
});

test('backfillWorkoutEnergy: dry run counts and writes nothing; without weight nothing is loaded', async () => {
  const dry = fakeStore({ weightKg: 95 }, HISTORY, workoutRows());
  assert.deepEqual(await createEnergyBackfill(dry.deps)('u1', { dryRun: true }), { pending: 3, updated: 0 });
  assert.ok(dry.rows.filter((r) => r.userId === 'u1' && r.id !== 'a3').every((r) => r.activeKcal === null));

  const noWeight = fakeStore({ weightKg: null }, HISTORY, workoutRows());
  assert.deepEqual(await createEnergyBackfill(noWeight.deps)('u1'), { pending: 0, updated: 0 });
  assert.equal(noWeight.calls.loadWorkouts, 0);
});

test('weightAppeared: only the move from empty to a value starts the backfill', () => {
  assert.equal(weightAppeared(null, 80), true);
  assert.equal(weightAppeared(undefined, 80), true);
  assert.equal(weightAppeared(80, 90), false);
  assert.equal(weightAppeared(80, null), false);
  assert.equal(weightAppeared(null, null), false);
});

test('editing a workout recalculates its calories when reps, sides, load, time or exercise change', () => {
  const before = { exerciseType: 'pushups', reps: 60, date: day('2026-10-12'), activeKcal: 17.3 };
  const body = { weightKg: 90 };
  assert.equal(editedWorkoutEnergy(before, { ...before, reps: 30 }, body), 9.8); // 60 с → (6.5) × 90 / 60
  assert.equal(
    editedWorkoutEnergy(
      { exerciseType: 'kettlebell_press', reps: 20, repsLeft: 10, repsRight: 10, loadKg: 16, date: day('2026-10-12'), activeKcal: 7.5 },
      { exerciseType: 'kettlebell_press', reps: 20, repsLeft: 10, repsRight: 10, loadKg: 24, date: day('2026-10-12') },
      body,
    ),
    12, // (6 × 1.5 − 1) × 90 × 60/3600
  );
  assert.equal(
    editedWorkoutEnergy(
      { exerciseType: 'run', reps: 5000, durationSeconds: 1800, date: day('2026-10-12'), activeKcal: 400 },
      { exerciseType: 'run', reps: 5000, durationSeconds: 1500, date: day('2026-10-12') },
      body,
    ) !== undefined,
    true,
  );
  // Только день/время — калории остаются прежними (вес на сегодня их не меняет).
  assert.equal(editedWorkoutEnergy(before, { ...before, date: day('2026-10-13') }, body), undefined);
  // Калорий ещё не было — посчитать.
  assert.equal(editedWorkoutEnergy({ ...before, activeKcal: null }, { ...before, activeKcal: null }, body), KCAL_60_PUSHUPS[90]);
  // Без веса — пусто.
  assert.equal(editedWorkoutEnergy(before, { ...before, reps: 30 }, { weightKg: null }), null);
});

test('hideForeignEnergy: own workouts keep calories, anyone else gets no field at all', () => {
  const w = { id: 'w1', reps: 10, activeKcal: 3.2 };
  assert.deepEqual(hideForeignEnergy(w, true), w);
  const foreign = hideForeignEnergy(w, false);
  assert.equal('activeKcal' in foreign, false);
  assert.deepEqual(foreign, { id: 'w1', reps: 10 });
});

// R01.4: калории видит только сам пользователь. API друзей, групп, лиги, челленджей, достижений и реакций
// читают тренировки только явным `select` без калорий; поле упоминается лишь в API своих тренировок.
const ROOT = path.resolve(__dirname, '..', '..');
const SOCIAL_SOURCES = [
  'src/app/api/friends/workouts/route.ts',
  'src/app/api/groups/[id]/workouts/route.ts',
  'src/app/api/league/route.ts',
  'src/lib/league.ts',
  'src/app/api/challenges/route.ts',
  'src/app/api/challenges/[id]/route.ts',
  'src/lib/group-goal.ts',
  'src/app/api/achievements/route.ts',
  'src/app/api/workout-reactions/route.ts',
];

/** Аргументы вызовов `.workout.findMany/findFirst/findUnique(...)` — по балансу скобок. */
function workoutQueryArgs(source: string): string[] {
  const out: string[] = [];
  const re = /\.workout\.find(?:Many|First|Unique)(?:OrThrow)?\(/g;
  for (let m = re.exec(source); m; m = re.exec(source)) {
    let depth = 1;
    let i = m.index + m[0].length;
    for (; i < source.length && depth > 0; i++) {
      if (source[i] === '(') depth += 1;
      else if (source[i] === ')') depth -= 1;
    }
    out.push(source.slice(m.index + m[0].length, i - 1));
  }
  return out;
}

test('calories never leave through the social APIs', () => {
  for (const rel of SOCIAL_SOURCES) {
    const source = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.equal(source.includes('activeKcal'), false, `${rel} mentions activeKcal`);
    // Каждый запрос тренировок — с явным списком полей (без select Prisma отдаёт все столбцы, включая калории).
    for (const call of workoutQueryArgs(source)) {
      assert.match(call, /\bselect:/, `${rel}: a workout query without select`);
    }
    assert.doesNotMatch(source, /workouts?:\s*true/, `${rel}: includes whole workout rows`);
  }
});
