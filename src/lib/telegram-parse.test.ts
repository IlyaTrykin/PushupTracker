import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkoutMessage } from './telegram/parse';
import { todayReply, workoutRecordedReply } from './telegram/replies';
import { createLinkCode, telegramStartLink, verifyWebhookSecret } from './telegram/config';

const favorites = ['squats', 'pushups'] as const;

test('a bare number goes to the first favourite exercise', () => {
  assert.deepEqual(parseWorkoutMessage('30', [...favorites]), { exerciseType: 'squats', value: 30 });
  assert.deepEqual(parseWorkoutMessage('  25 ', []), { exerciseType: 'pushups', value: 25 });
});

test('exercise name before or after the number, ru and en, any case', () => {
  const expected = { exerciseType: 'squats', value: 30 };
  assert.deepEqual(parseWorkoutMessage('30 приседания', ['pushups']), expected);
  assert.deepEqual(parseWorkoutMessage('Приседания 30', ['pushups']), expected);
  assert.deepEqual(parseWorkoutMessage('squats 30', ['pushups']), expected);
  assert.deepEqual(parseWorkoutMessage('30 приседаний', ['pushups']), expected);
  assert.deepEqual(parseWorkoutMessage('отжимания 40', ['squats']), { exerciseType: 'pushups', value: 40 });
  assert.deepEqual(parseWorkoutMessage('подтягивания 12', []), { exerciseType: 'pullups', value: 12 });
  assert.deepEqual(parseWorkoutMessage('отжимания на брусьях 15', []), { exerciseType: 'dips', value: 15 });
  assert.deepEqual(parseWorkoutMessage('бёрпи 10', []), { exerciseType: 'burpees', value: 10 });
});

test('timed exercises take seconds or m:ss', () => {
  assert.deepEqual(parseWorkoutMessage('планка 60', []), { exerciseType: 'plank', value: 60 });
  assert.deepEqual(parseWorkoutMessage('планка 1:30', []), { exerciseType: 'plank', value: 90 });
  assert.deepEqual(parseWorkoutMessage('plank 45s', []), { exerciseType: 'plank', value: 45 });
  assert.deepEqual(parseWorkoutMessage('90 стульчик', []), { exerciseType: 'wall_sit', value: 90 });
});

test('cardio takes kilometres (dot or comma) and an optional time; value is in metres', () => {
  assert.deepEqual(parseWorkoutMessage('бег 5.2', []), { exerciseType: 'run', value: 5200 });
  assert.deepEqual(parseWorkoutMessage('бег 5,2 26:30', []), { exerciseType: 'run', value: 5200, durationSeconds: 1590 });
  assert.deepEqual(parseWorkoutMessage('велосипед 20 км 1:02:05', []), { exerciseType: 'bike', value: 20000, durationSeconds: 3725 });
  assert.deepEqual(parseWorkoutMessage('row 2', []), { exerciseType: 'row', value: 2000 });
  // «Rowing» is the catalog name of the rowing machine in English.
  assert.deepEqual(parseWorkoutMessage('rowing 10', []), { exerciseType: 'row', value: 10000 });
  assert.deepEqual(parseWorkoutMessage('Rowing 10', []), { exerciseType: 'row', value: 10000 });
});

test('loaded exercises take the weight in kg', () => {
  assert.deepEqual(parseWorkoutMessage('жим 10 24кг', []), { exerciseType: 'kettlebell_press', value: 10, loadKg: 24 });
  assert.deepEqual(parseWorkoutMessage('жим 10 24 кг', []), { exerciseType: 'kettlebell_press', value: 10, loadKg: 24 });
  assert.deepEqual(parseWorkoutMessage('махи 20 16,5kg', []), { exerciseType: 'kettlebell_swing', value: 20, loadKg: 16.5 });
  assert.deepEqual(parseWorkoutMessage('толчок 8 24', []), { exerciseType: 'kettlebell_jerk', value: 8, loadKg: 24 });
  // Without the weight the exercise is still recognised; the bot asks for the weight.
  assert.deepEqual(parseWorkoutMessage('жим 10', []), { exerciseType: 'kettlebell_press', value: 10 });
});

test('commands, with an argument and a bot mention', () => {
  assert.deepEqual(parseWorkoutMessage('/start abc_DEF-123', []), { command: 'start', arg: 'abc_DEF-123' });
  assert.deepEqual(parseWorkoutMessage('/start', []), { command: 'start' });
  assert.deepEqual(parseWorkoutMessage('/today@PushupBot', []), { command: 'today' });
  assert.deepEqual(parseWorkoutMessage('/HELP', []), { command: 'help' });
  assert.deepEqual(parseWorkoutMessage('/stop', []), { command: 'stop' });
  assert.deepEqual(parseWorkoutMessage('/whatever', []), { command: 'whatever' });
  assert.deepEqual(parseWorkoutMessage('сегодня', []), { command: 'today' });
  assert.deepEqual(parseWorkoutMessage('помощь', []), { command: 'help' });
});

test('garbage → null', () => {
  for (const text of [
    '',
    '   ',
    'привет',
    '30 котиков',
    'отжимания',
    '30 40 отжимания',
    '30.5 отжиманий',
    'планка 1:75',
    'бег 5 км 26:30 40',
    'приседания 30 20кг',
    '-5',
    '30x',
    'бег abc',
    // Only listed word forms count, not anything that starts like an exercise name.
    'выходные 2',
    'pullover 10',
    'маховик 3',
    'pushkin 10',
    'бегемот 3',
    'жимолость 5',
  ]) {
    assert.equal(parseWorkoutMessage(text, ['pushups']), null, text);
  }
});

test('reply after a recorded workout: value, points and the daily goal, in the user language', () => {
  assert.equal(
    workoutRecordedReply('ru', { exerciseType: 'pushups', reps: 30, loadKg: null }, { done: 80, goal: 100 }),
    'Записал: 30 отжиманий (+30 баллов).\nЦель дня: 80/100',
  );
  assert.equal(
    workoutRecordedReply('en', { exerciseType: 'plank', reps: 60, loadKg: null }, null),
    'Logged: plank 60 s (+6 points).',
  );
  assert.equal(
    workoutRecordedReply('ru', { exerciseType: 'run', reps: 5200, loadKg: null, durationSeconds: 1590 }, { done: 120.5, goal: 100 }),
    'Записал: бег 5,2 км · 26:30 (5:06/км) (+78 баллов).\nЦель дня выполнена: 120,5/100 ✅',
  );
  assert.equal(
    workoutRecordedReply('ru', { exerciseType: 'squats', reps: 1, loadKg: null }, null),
    'Записал: 1 приседание (+0,7 балла).',
  );
});

test('counted exercises: the number first, then the name in the right form', () => {
  const ru = (reps: number, exerciseType = 'pushups', loadKg: number | null = null) =>
    workoutRecordedReply('ru', { exerciseType, reps, loadKg }, null).replace(/^Записал: | \(\+.*$/g, '');
  assert.equal(ru(1), '1 отжимание');
  assert.equal(ru(2), '2 отжимания');
  assert.equal(ru(5), '5 отжиманий');
  assert.equal(ru(11), '11 отжиманий');
  assert.equal(ru(21), '21 отжимание');
  assert.equal(ru(34), '34 отжимания');
  assert.equal(ru(112), '112 отжиманий');
  assert.equal(ru(3, 'muscle_ups'), '3 выхода силой');
  assert.equal(ru(15, 'dips'), '15 отжиманий на брусьях');
  assert.equal(ru(10, 'kettlebell_press', 24), '10 жимов гири × 24 кг');
  assert.equal(
    workoutRecordedReply('en', { exerciseType: 'pushups', reps: 30, loadKg: null }, null),
    'Logged: 30 push-ups (+30 points).',
  );
  assert.equal(workoutRecordedReply('en', { exerciseType: 'pullups', reps: 1, loadKg: null }, null), 'Logged: 1 pull-up (+3 points).');
  assert.equal(
    workoutRecordedReply('en', { exerciseType: 'kettlebell_swing', reps: 20, loadKg: 16 }, null).replace(/ \(\+.*$/, ''),
    'Logged: 20 kettlebell swings × 16 kg',
  );
});

test('/today summary sums each exercise and the day points', () => {
  assert.equal(todayReply('ru', [], null), 'Сегодня тренировок пока нет.');
  assert.equal(
    todayReply('ru', [
      { exerciseType: 'pushups', reps: 20, loadKg: null },
      { exerciseType: 'plank', reps: 60, loadKg: null },
      { exerciseType: 'pushups', reps: 21, loadKg: null },
    ], { done: 47, goal: 100 }),
    'Сегодня: 47 баллов\n• отжимания: 41\n• планка: 60 сек\nЦель дня: 47/100',
  );
});

test('webhook secret: exact match only, an unset secret never matches', () => {
  assert.equal(verifyWebhookSecret('s3cret-value', 's3cret-value'), true);
  assert.equal(verifyWebhookSecret('s3cret-valuX', 's3cret-value'), false);
  assert.equal(verifyWebhookSecret('s3cret', 's3cret-value'), false);
  assert.equal(verifyWebhookSecret(null, 's3cret-value'), false);
  assert.equal(verifyWebhookSecret('', ''), false);
});

test('start link and one-time code', () => {
  assert.equal(telegramStartLink('@PushupBot', 'abc'), 'https://t.me/PushupBot?start=abc');
  const a = createLinkCode();
  const b = createLinkCode();
  assert.match(a, /^[A-Za-z0-9_-]{32,64}$/);
  assert.notEqual(a, b);
});
