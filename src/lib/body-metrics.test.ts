import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HEIGHT_RANGE_CM,
  WEIGHT_RANGE_KG,
  parseBodyMetricInput,
  pickBodyMetricUpdates,
  type CurrentBodyMetrics,
} from './body-metrics';

const NOW = new Date('2026-10-19T12:00:00Z');

function profile(over: Partial<CurrentBodyMetrics> = {}): CurrentBodyMetrics {
  return {
    weightKg: null,
    weightUpdatedAt: null,
    heightCm: null,
    heightUpdatedAt: null,
    birthDate: null,
    gender: null,
    ...over,
  };
}

test('pickBodyMetricUpdates: fresher Health weight replaces the profile weight, source health', () => {
  const current = profile({ weightKg: 80, weightUpdatedAt: new Date('2026-10-01T08:00:00Z') });
  const updates = pickBodyMetricUpdates(current, { weightKg: 78.4, weightMeasuredAt: '2026-10-18T07:30:00Z' }, NOW);
  assert.equal(updates.weightKg, 78);
  assert.equal(updates.weightSource, 'health');
  assert.equal(updates.weightUpdatedAt?.toISOString(), '2026-10-18T07:30:00.000Z');
});

test('pickBodyMetricUpdates: older Health weight does not replace a newer manual edit', () => {
  const current = profile({ weightKg: 80, weightUpdatedAt: new Date('2026-10-18T09:00:00Z') });
  const updates = pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-10-10T07:30:00Z' }, NOW);
  assert.deepEqual(updates, {});
});

test('pickBodyMetricUpdates: an empty weight/height (never set) is filled even by an old measurement', () => {
  const current = profile({ profileUpdatedAt: new Date('2026-10-18T09:00:00Z') });
  const updates = pickBodyMetricUpdates(
    current,
    { weightKg: 70.6, weightMeasuredAt: '2025-01-01T00:00:00Z', heightCm: 181.4, heightMeasuredAt: '2024-05-05T00:00:00Z' },
    NOW,
  );
  assert.equal(updates.weightKg, 71);
  assert.equal(updates.weightSource, 'health');
  assert.equal(updates.heightCm, 181);
  assert.equal(updates.heightSource, 'health');
  assert.equal(updates.heightUpdatedAt?.toISOString(), '2024-05-05T00:00:00.000Z');
});

test('R04.1: a weight/height cleared by hand (empty, *UpdatedAt set) is filled only by a measurement newer than the clearing', () => {
  const clearedAt = new Date('2026-10-18T09:00:00Z');
  const cleared = profile({ weightUpdatedAt: clearedAt, heightUpdatedAt: clearedAt });
  // старый замер из Health не возвращает вес и рост, которые человек стёр
  assert.deepEqual(
    pickBodyMetricUpdates(cleared, { weightKg: 82, weightMeasuredAt: '2026-09-01T00:00:00Z', heightCm: 180, heightMeasuredAt: '2026-09-01T00:00:00Z' }, NOW),
    {},
  );
  // замер ровно в момент очистки — тоже нет; без даты замера — нет
  assert.deepEqual(pickBodyMetricUpdates(cleared, { weightKg: 82, weightMeasuredAt: clearedAt.toISOString() }, NOW), {});
  assert.deepEqual(pickBodyMetricUpdates(cleared, { weightKg: 82, heightCm: 180 }, NOW), {});
  // новый замер после очистки — заполняет, источник health
  const fresh = pickBodyMetricUpdates(
    cleared,
    { weightKg: 79.6, weightMeasuredAt: '2026-10-19T07:00:00Z', heightCm: 181.2, heightMeasuredAt: '2026-10-19T07:00:00Z' },
    NOW,
  );
  assert.equal(fresh.weightKg, 80);
  assert.equal(fresh.weightSource, 'health');
  assert.equal(fresh.heightCm, 181);
  assert.equal(fresh.heightSource, 'health');
});

test('R04.1: cleared before *UpdatedAt existed — the history change is the clearing date (weight and height)', () => {
  const clearedAt = new Date('2026-08-01T00:00:00Z');
  const legacy = profile({ weightLastChangedAt: clearedAt, heightLastChangedAt: clearedAt, profileUpdatedAt: new Date('2026-10-01T00:00:00Z') });
  assert.deepEqual(pickBodyMetricUpdates(legacy, { weightKg: 82, weightMeasuredAt: '2026-07-01T00:00:00Z', heightCm: 180, heightMeasuredAt: '2026-07-01T00:00:00Z' }, NOW), {});
  const fresh = pickBodyMetricUpdates(legacy, { weightKg: 82, weightMeasuredAt: '2026-09-01T00:00:00Z', heightCm: 180, heightMeasuredAt: '2026-09-01T00:00:00Z' }, NOW);
  assert.equal(fresh.weightKg, 82);
  assert.equal(fresh.heightCm, 180);
});

test('pickBodyMetricUpdates: fresher Health height replaces, older does not', () => {
  const current = profile({ heightCm: 175, heightUpdatedAt: new Date('2026-06-01T00:00:00Z') });
  assert.equal(pickBodyMetricUpdates(current, { heightCm: 176, heightMeasuredAt: '2026-09-01T00:00:00Z' }, NOW).heightCm, 176);
  assert.deepEqual(pickBodyMetricUpdates(current, { heightCm: 170, heightMeasuredAt: '2026-01-01T00:00:00Z' }, NOW), {});
});

test('pickBodyMetricUpdates: a value without a measurement date only fills an empty field', () => {
  const filled = profile({ weightKg: 80, weightUpdatedAt: new Date('2026-01-01T00:00:00Z') });
  assert.deepEqual(pickBodyMetricUpdates(filled, { weightKg: 75 }, NOW), {});
  const empty = pickBodyMetricUpdates(profile(), { weightKg: 75 }, NOW);
  assert.equal(empty.weightKg, 75);
  assert.equal(empty.weightUpdatedAt?.toISOString(), NOW.toISOString());
});

test('pickBodyMetricUpdates: values out of range are ignored', () => {
  const updates = pickBodyMetricUpdates(
    profile(),
    { weightKg: 12, weightMeasuredAt: '2026-10-18T00:00:00Z', heightCm: 40, heightMeasuredAt: '2026-10-18T00:00:00Z' },
    NOW,
  );
  assert.deepEqual(updates, {});
});

test('pickBodyMetricUpdates: a measurement from the future is stamped with now', () => {
  const current = profile({ weightKg: 80, weightUpdatedAt: new Date('2026-10-01T00:00:00Z') });
  const updates = pickBodyMetricUpdates(current, { weightKg: 79, weightMeasuredAt: '2027-01-01T00:00:00Z' }, NOW);
  assert.equal(updates.weightKg, 79);
  assert.equal(updates.weightUpdatedAt?.toISOString(), NOW.toISOString());
});

test('pickBodyMetricUpdates: birth date and sex fill only empty fields', () => {
  const empty = pickBodyMetricUpdates(profile(), { birthDate: '1990-04-12', sex: 'female' }, NOW);
  assert.equal(empty.birthDate, '1990-04-12');
  assert.equal(empty.gender, 'female');

  const filled = profile({ birthDate: new Date('1985-01-02T00:00:00Z'), gender: 'male' });
  assert.deepEqual(pickBodyMetricUpdates(filled, { birthDate: '1990-04-12', sex: 'female' }, NOW), {});
});

test('pickBodyMetricUpdates: invalid birth date or sex is ignored', () => {
  assert.deepEqual(pickBodyMetricUpdates(profile(), { birthDate: 'not-a-date', sex: 'unknown' as never }, NOW), {});
  assert.deepEqual(pickBodyMetricUpdates(profile(), { birthDate: '2030-01-01' }, NOW), {});
});

test('parseBodyMetricInput: rounds to whole units and checks the range', () => {
  assert.deepEqual(parseBodyMetricInput(70.6, WEIGHT_RANGE_KG), { ok: true, value: 71 });
  assert.deepEqual(parseBodyMetricInput('182.4', HEIGHT_RANGE_CM), { ok: true, value: 182 });
  assert.deepEqual(parseBodyMetricInput(undefined, HEIGHT_RANGE_CM), { ok: true, value: undefined });
  assert.deepEqual(parseBodyMetricInput(null, HEIGHT_RANGE_CM), { ok: true, value: null });
  assert.deepEqual(parseBodyMetricInput('', HEIGHT_RANGE_CM), { ok: true, value: null });
  assert.deepEqual(parseBodyMetricInput(99, HEIGHT_RANGE_CM), { ok: false });
  assert.deepEqual(parseBodyMetricInput(251, HEIGHT_RANGE_CM), { ok: false });
  assert.deepEqual(parseBodyMetricInput('abc', WEIGHT_RANGE_KG), { ok: false });
  assert.deepEqual(parseBodyMetricInput(250, HEIGHT_RANGE_CM), { ok: true, value: 250 });
});

// Профили до этой сборки: вес/рост заданы, а *UpdatedAt пуст. Дата сравнения — последнее
// изменение поля в истории профиля, иначе User.updatedAt.
test('pickBodyMetricUpdates: no weightUpdatedAt — a measurement older than the last history change does not replace', () => {
  const current = profile({
    weightKg: 80,
    weightLastChangedAt: new Date('2026-09-01T10:00:00Z'),
    profileUpdatedAt: new Date('2026-10-15T10:00:00Z'),
  });
  assert.deepEqual(pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-08-20T07:00:00Z' }, NOW), {});
});

test('pickBodyMetricUpdates: no weightUpdatedAt — a measurement newer than the last history change replaces', () => {
  const current = profile({
    weightKg: 80,
    weightLastChangedAt: new Date('2026-09-01T10:00:00Z'),
    profileUpdatedAt: new Date('2026-10-15T10:00:00Z'),
  });
  const updates = pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-09-05T07:00:00Z' }, NOW);
  assert.equal(updates.weightKg, 76);
  assert.equal(updates.weightSource, 'health');
});

test('pickBodyMetricUpdates: no weightUpdatedAt — a measurement at exactly the history date does not replace', () => {
  const current = profile({ weightKg: 80, weightLastChangedAt: new Date('2026-09-01T10:00:00Z') });
  assert.deepEqual(pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-09-01T10:00:00Z' }, NOW), {});
});

test('pickBodyMetricUpdates: no weightUpdatedAt and no history — compared with the profile updatedAt', () => {
  const current = profile({ weightKg: 80, profileUpdatedAt: new Date('2026-10-01T00:00:00Z') });
  assert.deepEqual(pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-09-30T00:00:00Z' }, NOW), {});
  assert.deepEqual(pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-10-01T00:00:00Z' }, NOW), {});
  assert.equal(pickBodyMetricUpdates(current, { weightKg: 76, weightMeasuredAt: '2026-10-02T00:00:00Z' }, NOW).weightKg, 76);
});

test('pickBodyMetricUpdates: no heightUpdatedAt — the same rule for height (history, then profile updatedAt)', () => {
  const withHistory = profile({
    heightCm: 175,
    heightLastChangedAt: new Date('2026-07-01T00:00:00Z'),
    profileUpdatedAt: new Date('2026-10-15T00:00:00Z'),
  });
  assert.deepEqual(pickBodyMetricUpdates(withHistory, { heightCm: 178, heightMeasuredAt: '2026-06-01T00:00:00Z' }, NOW), {});
  assert.deepEqual(pickBodyMetricUpdates(withHistory, { heightCm: 178, heightMeasuredAt: '2026-07-01T00:00:00Z' }, NOW), {});
  assert.equal(pickBodyMetricUpdates(withHistory, { heightCm: 178, heightMeasuredAt: '2026-07-02T00:00:00Z' }, NOW).heightCm, 178);

  const noHistory = profile({ heightCm: 175, profileUpdatedAt: new Date('2026-10-15T00:00:00Z') });
  assert.deepEqual(pickBodyMetricUpdates(noHistory, { heightCm: 178, heightMeasuredAt: '2026-10-10T00:00:00Z' }, NOW), {});
});
