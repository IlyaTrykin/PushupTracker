import assert from 'node:assert/strict';
import test from 'node:test';
import { ageOn, estimateActiveEnergy, workoutDurationSeconds } from './energy';

// Ожидаемые значения разобраны вручную по формуле спецификации: активные ккал = (MET − 1) × вес × часы
// при стандартном MET (покой 3,5 мл/кг/мин); с поправкой — покой по Харрису—Бенедикту.
const W80 = { weightKg: 80 };

test('50 push-ups at 80 kg: 100 s at 2 s per rep, (7.5 − 1) × 80 × 100/3600 ≈ 14.4 kcal', () => {
  const kcal = estimateActiveEnergy({ exerciseType: 'pushups', reps: 50 }, W80);
  assert.ok(kcal !== null && kcal >= 10 && kcal <= 20, `got ${kcal}`);
  assert.equal(kcal, 14.4);
});

test('5 km run in 30 min at 80 kg lands in 350–450 kcal (≈10 MET at 10 km/h)', () => {
  const kcal = estimateActiveEnergy({ exerciseType: 'run', reps: 5000, durationSeconds: 1800 }, W80);
  assert.ok(kcal !== null && kcal >= 350 && kcal <= 450, `got ${kcal}`);
});

test('without height, age or sex — the standard MET; a partial profile does not change it', () => {
  const pushups = { exerciseType: 'pushups', reps: 50 };
  assert.equal(estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 180 }, '2026-10-19'), 14.4);
  assert.equal(estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 180, sex: 'male' }, '2026-10-19'), 14.4);
  assert.equal(estimateActiveEnergy(pushups, { weightKg: 80, birthDate: '1996-01-01', sex: 'male' }, '2026-10-19'), 14.4);
});

test('with height, age and sex the MET is corrected by the Harris—Benedict resting rate', () => {
  const pushups = { exerciseType: 'pushups', reps: 50 };
  // Мужчина 30 лет, 180 см, 80 кг: RMR 1853.6 ккал/сут = 3.218 мл/кг/мин → (7.5 − 0.9195) × 80 × 100/3600 = 14.62.
  const man = estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 180, birthDate: '1996-01-01', sex: 'male' }, '2026-10-19');
  assert.equal(man, 14.6);
  // Женщина 60 лет, 160 см, 80 кг: RMR 1423.2 ккал/сут = 2.471 мл/кг/мин → (7.5 − 0.706) × 80 × 100/3600 = 15.10.
  const woman = estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 160, birthDate: '1966-01-01', sex: 'female' }, '2026-10-19');
  assert.equal(woman, 15.1);
  // «Другое» — между мужской и женской формулой при тех же данных.
  const male = estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 170, birthDate: '1990-01-01', sex: 'male' }, '2026-10-19')!;
  const female = estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 170, birthDate: '1990-01-01', sex: 'female' }, '2026-10-19')!;
  const other = estimateActiveEnergy(pushups, { weightKg: 80, heightCm: 170, birthDate: '1990-01-01', sex: 'other' }, '2026-10-19')!;
  assert.ok(male < other && other < female, `${male} < ${other} < ${female}`);
});

test('no weight — no calories', () => {
  const pushups = { exerciseType: 'pushups', reps: 50 };
  assert.equal(estimateActiveEnergy(pushups, { weightKg: null }), null);
  assert.equal(estimateActiveEnergy(pushups, { weightKg: 0 }), null);
  assert.equal(estimateActiveEnergy(pushups, { weightKg: null, heightCm: 180, birthDate: '1990-01-01', sex: 'male' }), null);
});

test('a heavier kettlebell burns more: MET × (kg / reference), limited to ×0.7…×1.5', () => {
  // Жим 10/10 на руку, 3 с на повтор → 60 с; эталон 16 кг, MET 6.
  const press = (loadKg: number | null) =>
    estimateActiveEnergy({ exerciseType: 'kettlebell_press', reps: 20, repsLeft: 10, repsRight: 10, loadKg }, W80);
  assert.equal(press(16), 6.7); // (6 − 1) × 80 / 60
  assert.equal(press(null), 6.7); // без веса гири — как эталон
  assert.equal(press(32), 10.7); // ×2 → ограничено ×1.5: (9 − 1) × 80 / 60
  assert.equal(press(24), 10.7); // ровно ×1.5
  assert.equal(press(8), 4.3); // ×0.5 → ограничено ×0.7: (4.2 − 1) × 80 / 60
  assert.ok(press(20)! > press(16)! && press(16)! > press(12)!);
});

test('duration: reps × the exercise pace', () => {
  assert.equal(workoutDurationSeconds({ exerciseType: 'pushups', reps: 50 }), 100);
  assert.equal(workoutDurationSeconds({ exerciseType: 'jump_rope', reps: 120 }), 60);
  assert.equal(workoutDurationSeconds({ exerciseType: 'burpees', reps: 20 }), 80);
});

test('duration: at least 30 s', () => {
  assert.equal(workoutDurationSeconds({ exerciseType: 'pushups', reps: 5 }), 30);
  assert.equal(workoutDurationSeconds({ exerciseType: 'plank', reps: 12 }), 30);
});

test('duration: a timed exercise lasts its value; per-side exercises add up both sides', () => {
  assert.equal(workoutDurationSeconds({ exerciseType: 'plank', reps: 90 }), 90);
  // Боковая планка 40 с на сторону → 80 с.
  assert.equal(workoutDurationSeconds({ exerciseType: 'side_plank', reps: 40, repsLeft: 40, repsRight: 40 }), 80);
  // Выпады 12 + 8 на ногу, 2.5 с на повтор → 50 с.
  assert.equal(workoutDurationSeconds({ exerciseType: 'lunges', reps: 10, repsLeft: 12, repsRight: 8 }), 50);
});

test('duration: a distance uses its own time, otherwise the typical pace', () => {
  assert.equal(workoutDurationSeconds({ exerciseType: 'run', reps: 5000, durationSeconds: 1500 }), 1500);
  assert.equal(workoutDurationSeconds({ exerciseType: 'run', reps: 5000 }), 1800); // 10 км/ч
  assert.equal(workoutDurationSeconds({ exerciseType: 'bike', reps: 10000, durationSeconds: null }), 1440); // 25 км/ч
  assert.equal(workoutDurationSeconds({ exerciseType: 'row', reps: 2000 }), 600); // 2:30 на 500 м
});

test('cardio MET follows speed: a faster run of the same distance burns more per minute', () => {
  const slow = estimateActiveEnergy({ exerciseType: 'run', reps: 5000, durationSeconds: 2400 }, W80)!; // 7.5 км/ч
  const fast = estimateActiveEnergy({ exerciseType: 'run', reps: 5000, durationSeconds: 1500 }, W80)!; // 12 км/ч
  assert.ok(fast / 25 > slow / 40, `${fast}/25 min vs ${slow}/40 min`);
  // Гребля 2000 м за 8 мин ≈ 200 Вт ≈ 12 MET: (12 − 1) × 80 × 8/60 ≈ 117 ккал.
  const row = estimateActiveEnergy({ exerciseType: 'row', reps: 2000, durationSeconds: 480 }, W80)!;
  assert.ok(row >= 100 && row <= 135, `got ${row}`);
});

test('zero reps — zero calories; the result has one decimal', () => {
  assert.equal(estimateActiveEnergy({ exerciseType: 'pushups', reps: 0 }, W80), 0);
  const kcal = estimateActiveEnergy({ exerciseType: 'squats', reps: 33 }, { weightKg: 77 })!;
  assert.equal(kcal, Math.round(kcal * 10) / 10);
  assert.ok(kcal > 0);
});

test('ageOn: full years on the given day', () => {
  assert.equal(ageOn('1990-10-20', '2026-10-19'), 35);
  assert.equal(ageOn('1990-10-20', '2026-10-20'), 36);
  assert.equal(ageOn('1990-10-20T00:00:00.000Z', '2026-12-31'), 36);
});
