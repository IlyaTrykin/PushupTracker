<!-- autopilot:start -->
# PushupTracker

Трекер тренировок (отжимания и ещё 14 упражнений) с баллами, друзьями, группами, челленджами и программами — Next.js App Router + Prisma + Postgres.

## Команды

| Команда | Что делает |
|---------|------------|
| `npm ci` | Установить зависимости |
| `npm run dev` | Запустить локально (нужен `DATABASE_URL`) |
| `npm test && npx tsc --noEmit && npm run lint` | Тесты, типы и линтер |

## Как здесь работает Autopilot

Сборка ведётся навыком `/autopilot`. Требования, спецификация и таски — в `.autopilot/`
(локально, исключено через `.git/info/exclude`: репозиторий публичный).
Прогресс — `.autopilot/dashboard.html`. Требование из `manifest.md` может снять
только пользователь. Прерванную сборку продолжает «продолжи автопилот».
<!-- autopilot:end -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
