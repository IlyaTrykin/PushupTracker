import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShareCard, displayLink, shareCardFileName, shareCardUrl, streakDaysWord } from './share-card';
import { getExercise } from './exercises';

test('record card shows the value, the exercise and its accent colour', () => {
  const card = buildShareCard({ kind: 'record', record: 'best_set', exerciseType: 'pushups', value: 31 }, 'ru');
  assert.equal(card.emoji, '🏆');
  assert.equal(card.eyebrow, 'Рекорд подхода');
  assert.equal(card.headline, '31');
  assert.equal(card.caption, 'Отжимания');
  assert.equal(card.accent, getExercise('pushups').colors.accent);
  assert.match(card.text, /Рекорд подхода: Отжимания — 31!/);
});

test('distance record is shown in km, best day has its own title', () => {
  const card = buildShareCard({ kind: 'record', record: 'best_day', exerciseType: 'run', value: 5200 }, 'en');
  assert.equal(card.eyebrow, 'Best day');
  assert.equal(card.headline, '5.2 km');
});

test('badge card uses the badge icon, title and description', () => {
  const card = buildShareCard({ kind: 'badge', code: 'streak_7' }, 'ru');
  assert.equal(card.emoji, '🔥');
  assert.equal(card.headline, 'Неделя подряд');
  assert.equal(card.caption, 'Серия 7 дней');
  assert.match(card.text, /«Неделя подряд»/);
});

test('streak card agrees the day word with the number', () => {
  assert.equal(buildShareCard({ kind: 'streak', days: 21 }, 'ru').caption, 'день подряд');
  assert.equal(buildShareCard({ kind: 'streak', days: 3 }, 'ru').caption, 'дня подряд');
  assert.equal(buildShareCard({ kind: 'streak', days: 12 }, 'ru').caption, 'дней подряд');
  assert.equal(buildShareCard({ kind: 'streak', days: 1 }, 'en').caption, 'day in a row');
  assert.equal(streakDaysWord(111, 'ru'), 'дней подряд');
  assert.match(buildShareCard({ kind: 'streak', days: 5 }, 'ru').text, /Уже 5 дней подряд/);
});

test('league card: medal by place, ordinal in English, previous week has its own label', () => {
  const ru = buildShareCard({ kind: 'league', week: 'previous', place: 1, total: 5, points: 340 }, 'ru');
  assert.equal(ru.emoji, '🥇');
  assert.equal(ru.eyebrow, 'Итог лиги недели');
  assert.equal(ru.headline, '1-е место');
  assert.equal(ru.caption, 'из 5 · 340 баллов');

  const en = buildShareCard({ kind: 'league', week: 'current', place: 2, total: 4, points: 12.5 }, 'en');
  assert.equal(en.emoji, '🥈');
  assert.equal(en.eyebrow, 'Weekly league');
  assert.equal(en.headline, '2nd place');
  assert.equal(en.caption, 'of 4 · 12.5 points');
  assert.equal(buildShareCard({ kind: 'league', week: 'current', place: 7, total: 9, points: 1 }, 'en').emoji, '🏁');
});

test('shareCardUrl tags the invite link with the card kind', () => {
  const url = new URL(shareCardUrl('https://example.test/invite/abcd2345', 'streak'));
  assert.equal(url.pathname, '/invite/abcd2345');
  assert.equal(url.searchParams.get('utm_source'), 'share');
  assert.equal(url.searchParams.get('utm_medium'), 'card');
  assert.equal(url.searchParams.get('utm_campaign'), 'streak');
  assert.equal(shareCardUrl('not a url', 'badge'), 'not a url');
});

test('displayLink drops the scheme and the query', () => {
  assert.equal(displayLink('https://example.test/invite/abcd2345?utm_source=share'), 'example.test/invite/abcd2345');
  assert.equal(displayLink('https://example.test/'), 'example.test');
  assert.equal(shareCardFileName('league'), 'pushup-tracker-league.png');
});
