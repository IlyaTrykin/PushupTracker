import test from 'node:test';
import assert from 'node:assert/strict';
import { friendWorkoutText, rankChallengeParticipants } from './workout-create';

const day = (d: string) => new Date(`${d}T00:00:00.000Z`);

test('B26: a participant who left the group does not take a place in the rank-change push', () => {
  const ranks = rankChallengeParticipants({
    mode: 'most',
    exerciseType: 'pushups',
    targetReps: null,
    totalDays: 7,
    participants: [
      { userId: 'gone', username: 'anna', status: 'accepted' },
      { userId: 'b', username: 'boris', status: 'accepted' },
      { userId: 'c', username: 'clara', status: 'accepted' },
      { userId: 'p', username: 'petr', status: 'pending' },
    ],
    activeMemberIds: ['b', 'c', 'p'],
    workouts: [
      { userId: 'gone', date: day('2026-10-05'), reps: 50 },
      { userId: 'b', date: day('2026-10-05'), reps: 30 },
      { userId: 'c', date: day('2026-10-06'), reps: 10 },
      { userId: 'p', date: day('2026-10-06'), reps: 99 },
    ],
  });

  assert.deepEqual([...ranks.entries()], [['b', 1], ['c', 2]]);
});

test('ranks follow the challenge table: loaded exercises in points, ties by username', () => {
  const ranks = rankChallengeParticipants({
    mode: 'most',
    exerciseType: 'kettlebell_swing',
    targetReps: null,
    totalDays: 7,
    participants: [
      { userId: 'z', username: 'zoe', status: 'accepted' },
      { userId: 'a', username: 'adam', status: 'accepted' },
      { userId: 'h', username: 'heavy', status: 'accepted' },
    ],
    activeMemberIds: null,
    workouts: [
      { userId: 'z', date: day('2026-10-05'), reps: 20, loadKg: 16 },
      { userId: 'a', date: day('2026-10-05'), reps: 20, loadKg: 16 },
      // Fewer reps with a heavier kettlebell are more points.
      { userId: 'h', date: day('2026-10-05'), reps: 15, loadKg: 32 },
    ],
  });

  assert.deepEqual([...ranks.entries()], [['h', 1], ['a', 2], ['z', 3]]);
});

test('friend notification: catalog name in the recipient language, cardio in km, others unchanged', () => {
  const run = { exerciseType: 'run', reps: 5200, loadKg: null, durationSeconds: 1590 };
  assert.deepEqual(friendWorkoutText('ru', 'bob', run).body, 'bob: Бег — 5,2 км · 26:30 (5:06/км)');
  assert.equal(friendWorkoutText('en', 'bob', run).body, 'bob: Running — 5.2 km · 26:30 (5:06/km)');
  assert.equal(friendWorkoutText('en', 'bob', { exerciseType: 'plank', reps: 60, loadKg: null }).body, 'bob: Plank — 60 s');
});
