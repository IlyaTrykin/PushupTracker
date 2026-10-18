import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillLegal, readLegalOperator } from './legal';

test('readLegalOperator: значения из env, пробелы по краям убираются', () => {
  const op = readLegalOperator({ LEGAL_OPERATOR_NAME: '  Тест Тестович ', LEGAL_CONTACT_EMAIL: ' test@example.com ' });
  assert.deepEqual(op, { name: 'Тест Тестович', email: 'test@example.com', configured: true });
});

test('readLegalOperator: пустые и отсутствующие значения дают null и configured=false', () => {
  assert.deepEqual(readLegalOperator({ LEGAL_OPERATOR_NAME: '', LEGAL_CONTACT_EMAIL: '   ' }), {
    name: null,
    email: null,
    configured: false,
  });
  assert.equal(readLegalOperator({}).configured, false);
});

test('readLegalOperator: email без собаки считается незаданным', () => {
  const op = readLegalOperator({ LEGAL_OPERATOR_NAME: 'Тест', LEGAL_CONTACT_EMAIL: 'не-адрес' });
  assert.equal(op.email, null);
  assert.equal(op.configured, false);
});

test('fillLegal: подставляет оператора и email, а без значений — видимую заглушку', () => {
  const text = 'Оператор: {operator}. Почта: {email}.';
  const set = { name: 'Тест', email: 'a@b.co', configured: true };
  assert.equal(fillLegal(text, set, { operator: '[НЕТ ИМЕНИ]', email: '[НЕТ ПОЧТЫ]' }), 'Оператор: Тест. Почта: a@b.co.');
  const empty = { name: null, email: null, configured: false };
  assert.equal(
    fillLegal(text, empty, { operator: '[НЕТ ИМЕНИ]', email: '[НЕТ ПОЧТЫ]' }),
    'Оператор: [НЕТ ИМЕНИ]. Почта: [НЕТ ПОЧТЫ].',
  );
});
