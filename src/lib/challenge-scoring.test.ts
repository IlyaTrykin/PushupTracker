import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHALLENGE_NAME_MAX_LENGTH,
  CHALLENGE_PARTICIPANTS_MAX,
  challengeDayKey,
  challengeDayStatus,
  challengeTotalDays,
  challengeUsesPoints,
  formatChallengeDay,
  scoreChallenge,
  splitChallengeInvitees,
  type ChallengeWorkoutRow,
} from './challenge-scoring';

const day = (key: string) => new Date(`${key}T00:00:00.000Z`); // Workout.date / Challenge.*Date convention

test('a challenge is still running on its last day and finished only the day after (B09)', () => {
  const start = '2026-10-01';
  const end = '2026-10-31';
  assert.deepEqual(challengeDayStatus(start, end, '2026-10-31'), { upcoming: false, active: true, finished: false, daysLeft: 0 });
  assert.deepEqual(challengeDayStatus(start, end, '2026-11-01'), { upcoming: false, active: false, finished: true, daysLeft: 0 });
  assert.deepEqual(challengeDayStatus(start, end, '2026-09-30'), { upcoming: true, active: false, finished: false, daysLeft: 31 });
  assert.equal(challengeDayStatus(start, end, '2026-10-29').daysLeft, 2);
});

test('challenge dates come from the stored UTC day, never shifted by the viewer zone', () => {
  assert.equal(challengeDayKey('2026-10-31T00:00:00.000Z'), '2026-10-31');
  assert.equal(challengeDayKey(day('2026-01-01')), '2026-01-01');
  assert.equal(formatChallengeDay('2026-10-31', 'ru-RU'), '31.10.2026');
  assert.equal(formatChallengeDay('2026-10-31T00:00:00.000Z', 'en-US'), '10/31/2026');
  assert.equal(challengeTotalDays('2026-10-01', '2026-10-31'), 31);
  assert.equal(challengeTotalDays('2026-10-05', '2026-10-05'), 1);
});

test('loaded exercises are compared in points: 30×24 kg beats 50×8 kg (B10)', () => {
  assert.equal(challengeUsesPoints('kettlebell_press'), true);
  assert.equal(challengeUsesPoints('pushups'), false);

  const workouts: ChallengeWorkoutRow[] = [
    { userId: 'a', date: day('2026-10-02'), reps: 50, loadKg: 8 },
    { userId: 'b', date: day('2026-10-02'), reps: 30, loadKg: 24 },
  ];
  const rows = scoreChallenge({
    mode: 'most',
    exerciseType: 'kettlebell_press',
    targetReps: null,
    participantIds: ['a', 'b'],
    workouts,
    totalDays: 31,
  });
  assert.deepEqual(rows.map((r) => r.userId), ['b', 'a']);
  // audit B10: B's load is 5.4× A's (30·24² vs 50·8²)
  assert.ok(Math.abs(rows[0].total / rows[1].total - 5.4) < 0.05, `ratio ${rows[0].total / rows[1].total}`);
});

test('bodyweight challenges keep summing raw reps', () => {
  const rows = scoreChallenge({
    mode: 'target',
    exerciseType: 'pushups',
    targetReps: 100,
    participantIds: ['a', 'b', 'c'],
    workouts: [
      { userId: 'a', date: day('2026-10-02'), reps: 30 },
      { userId: 'a', date: day('2026-10-03'), reps: 25 },
      { userId: 'b', date: day('2026-10-02'), reps: 70 },
      { userId: 'stranger', date: day('2026-10-02'), reps: 999 },
    ],
    totalDays: 31,
  });
  assert.deepEqual(rows, [
    { userId: 'b', total: 70 },
    { userId: 'a', total: 55 },
    { userId: 'c', total: 0 },
  ]);
});

test('sets_min for one-arm exercises counts the weaker side (B10)', () => {
  const rows = scoreChallenge({
    mode: 'sets_min',
    exerciseType: 'kettlebell_press',
    targetReps: 10,
    participantIds: ['a', 'b'],
    workouts: [
      { userId: 'a', date: day('2026-10-02'), reps: 10, loadKg: 16, repsLeft: 5, repsRight: 5 }, // 5 per arm — not a set of 10
      { userId: 'b', date: day('2026-10-02'), reps: 22, loadKg: 16, repsLeft: 10, repsRight: 12 }, // weaker arm 10 — counts
      { userId: 'b', date: day('2026-10-03'), reps: 20, loadKg: 16 }, // no split recorded: ≤ 10 per arm — counts
      { userId: 'b', date: day('2026-10-04'), reps: 19, loadKg: 16 }, // no split: weaker arm ≤ 9 — does not count
    ],
    totalDays: 31,
  });
  assert.deepEqual(rows, [
    { userId: 'b', total: 2, qualifiedSets: 2, qualifiedReps: 42 },
    { userId: 'a', total: 0, qualifiedSets: 0, qualifiedReps: 0 },
  ]);
});

test('sets_min for two-arm exercises uses the full set', () => {
  const rows = scoreChallenge({
    mode: 'sets_min',
    exerciseType: 'pushups',
    targetReps: 20,
    participantIds: ['a'],
    workouts: [
      { userId: 'a', date: day('2026-10-02'), reps: 20 },
      { userId: 'a', date: day('2026-10-02'), reps: 19 },
    ],
    totalDays: 31,
  });
  assert.deepEqual(rows, [{ userId: 'a', total: 1, qualifiedSets: 1, qualifiedReps: 20 }]);
});

test('daily_min credits days whose total reaches the threshold', () => {
  const rows = scoreChallenge({
    mode: 'daily_min',
    exerciseType: 'squats',
    targetReps: 50,
    participantIds: ['a'],
    workouts: [
      { userId: 'a', date: day('2026-10-02'), reps: 30 },
      { userId: 'a', date: day('2026-10-02'), reps: 20 },
      { userId: 'a', date: day('2026-10-03'), reps: 49 },
      { userId: 'a', date: day('2026-10-04'), reps: 60 },
    ],
    totalDays: 3,
  });
  assert.deepEqual(rows, [{ userId: 'a', total: 2, creditedDays: 2, totalDays: 3 }]);
});

test('only friends can be invited; unknown and non-friend names are reported together', () => {
  assert.equal(CHALLENGE_NAME_MAX_LENGTH, 80);
  assert.equal(CHALLENGE_PARTICIPANTS_MAX, 50);
  const result = splitChallengeInvitees(['bob', 'eve', 'ghost', 'me', 'bob', ' alice '], ['bob', 'alice', 'carol'], 'me');
  assert.deepEqual(result, { invited: ['bob', 'alice'], notFriends: ['eve', 'ghost'] });
});
