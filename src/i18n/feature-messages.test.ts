import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * R19i: строки новых фич (`src/i18n/messages/features/*.ts`) живут парами `{ ru, en }`.
 * У английской и русской половины должен быть один и тот же набор ключей на любой глубине,
 * иначе в одном из языков фраза молча пропадёт (или покажется `undefined`).
 */

const FEATURES_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), 'messages', 'features');

type Shape = 'object' | 'leaf';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Пути всех ключей объекта (`a`, `a.b`, `list.0.title`, …) с видом значения: вложенный объект
 * (или массив — разделы документа, пункты списка) либо лист.
 */
function keyPaths(value: Record<string, unknown> | unknown[], prefix = ''): Map<string, Shape> {
  const out = new Map<string, Shape>();
  for (const [key, child] of Object.entries(value)) {
    const at = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(child) || Array.isArray(child)) {
      out.set(at, 'object');
      for (const [nested, shape] of keyPaths(child, at)) out.set(nested, shape);
    } else {
      out.set(at, 'leaf');
    }
  }
  return out;
}

/** Расхождения ru/en: ключи только в одном языке и ключи с разным видом значения. */
function localeKeyMismatches(ru: Record<string, unknown>, en: Record<string, unknown>): string[] {
  const ruKeys = keyPaths(ru);
  const enKeys = keyPaths(en);
  const problems: string[] = [];
  for (const [key, shape] of ruKeys) {
    const other = enKeys.get(key);
    if (!other) problems.push(`нет в en: ${key}`);
    else if (other !== shape) problems.push(`разный вид: ${key} (ru ${shape}, en ${other})`);
  }
  for (const key of enKeys.keys()) {
    if (!ruKeys.has(key)) problems.push(`нет в ru: ${key}`);
  }
  return problems;
}

function featureFiles(): string[] {
  return readdirSync(FEATURES_DIR)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.d.ts'))
    .sort();
}

test('the checker itself: a key missing in one locale or a different nesting is reported', () => {
  assert.deepEqual(localeKeyMismatches({ a: '1', b: { c: '2' } }, { a: '1', b: { c: '2' } }), []);
  assert.deepEqual(localeKeyMismatches({ a: '1', b: '2' }, { a: '1' }), ['нет в en: b']);
  assert.deepEqual(localeKeyMismatches({ a: '1' }, { a: '1', z: '3' }), ['нет в ru: z']);
  assert.deepEqual(localeKeyMismatches({ a: { x: '1' } }, { a: 'flat' }), ['разный вид: a (ru object, en leaf)', 'нет в en: a.x']);
  assert.deepEqual(localeKeyMismatches({ list: [{ t: '1' }, { t: '2' }] }, { list: [{ t: '1' }] }), ['нет в en: list.1', 'нет в en: list.1.t']);
});

test('every feature messages file exports { ru, en } pairs with the same keys', async () => {
  const files = featureFiles();
  assert.ok(files.length > 10, `feature files not found in ${FEATURES_DIR}`);
  const problems: string[] = [];
  let pairs = 0;
  for (const file of files) {
    const mod = (await import(pathToFileURL(path.join(FEATURES_DIR, file)).href)) as Record<string, unknown>;
    for (const [exportName, value] of Object.entries(mod)) {
      if (!isPlainObject(value) || !isPlainObject(value.ru) || !isPlainObject(value.en)) continue;
      pairs += 1;
      for (const problem of localeKeyMismatches(value.ru, value.en)) problems.push(`${file} → ${exportName}: ${problem}`);
    }
  }
  assert.ok(pairs >= files.length - 1, `too few { ru, en } exports: ${pairs} in ${files.length} files`);
  assert.deepEqual(problems, []);
});
