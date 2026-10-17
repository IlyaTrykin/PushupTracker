#!/usr/bin/env node
// Статическая сборка интерфейса для приложения: `BUILD_TARGET=native next build`
// (экспорт в .next-native/), затем копия в out/ без того, что приложению не нужно или
// не должно попасть в бандл: загрузки пользователей, service worker, файлы верификации
// поисковиков, OG-картинки. Адрес сервера — env NATIVE_API_BASE (см. next.config.ts).
//
// Next 16 при `output: 'export'` с собственным distDir кладёт туда только экспорт, а
// промежуточную сборку — всегда в .next (node_modules/next/dist/export/utils.js,
// getBuildDistDir). Чтобы не затереть сборку сайта и его .next/types, файлы сайта на
// время сборки откладываются в tmp/ и возвращаются; .next/dev и кэш не трогаются.
// Не запускать параллельно с `npm run build`.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const buildDir = path.join(root, '.next');
const exportDir = path.join(root, '.next-native');
const outDir = path.join(root, 'out');
const stashDir = path.join(root, 'tmp', 'next-web-stash');
const SHARED = new Set(['cache', 'dev', 'diagnostics', 'lock', 'trace']);

function ownEntries(dir) {
  return existsSync(dir) ? readdirSync(dir).filter((name) => !SHARED.has(name)) : [];
}

function stashWebBuild() {
  if (existsSync(stashDir) && readdirSync(stashDir).length > 0) {
    throw new Error(`build:native: ${path.relative(root, stashDir)} is not empty — a previous run was interrupted; restore it into .next first`);
  }
  mkdirSync(stashDir, { recursive: true });
  for (const name of ownEntries(buildDir)) renameSync(path.join(buildDir, name), path.join(stashDir, name));
}

function restoreWebBuild() {
  for (const name of ownEntries(buildDir)) rmSync(path.join(buildDir, name), { recursive: true, force: true });
  if (!existsSync(stashDir)) return;
  mkdirSync(buildDir, { recursive: true });
  for (const name of readdirSync(stashDir)) renameSync(path.join(stashDir, name), path.join(buildDir, name));
  rmSync(stashDir, { recursive: true, force: true });
}

stashWebBuild();
let status;
try {
  const build = spawnSync('npx', ['next', 'build'], {
    stdio: 'inherit',
    env: { ...process.env, BUILD_TARGET: 'native' },
  });
  status = build.status ?? 1;
} finally {
  restoreWebBuild();
}
if (status !== 0) process.exit(status);

if (!existsSync(path.join(exportDir, 'index.html'))) {
  console.error('build:native: .next-native/index.html not found — export did not run');
  process.exit(1);
}

const EXCLUDED = [
  /^uploads(\/|$)/,
  /^sw\.js$/,
  /^google[0-9a-f]+\.html$/,
  /^yandex_[0-9a-f]+\.html$/,
  /^og-image-[a-z]+\.png$/,
  /(^|\/)\.DS_Store$/,
];

rmSync(outDir, { recursive: true, force: true });
cpSync(exportDir, outDir, {
  recursive: true,
  filter: (source) => {
    const relative = path.relative(exportDir, source).split(path.sep).join('/');
    return !relative || !EXCLUDED.some((pattern) => pattern.test(relative));
  },
});
console.log(`build:native: static app in ${path.relative(root, outDir)}/`);
