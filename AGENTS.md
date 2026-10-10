<!-- autopilot:start -->
# PushupTracker

## Команды

```sh
npm ci
docker run -d --name pushup-local-test -e POSTGRES_USER=pushup -e POSTGRES_PASSWORD=pushup -e POSTGRES_DB=pushup_test -p 127.0.0.1:55432:5432 postgres:16-alpine   # один раз; потом docker start pushup-local-test
export DATABASE_URL=postgresql://pushup:pushup@127.0.0.1:55432/pushup_test
npx prisma migrate deploy
npx tsx scripts/seed-demo.ts   # вход demo / demo123
SMTP_HOST= SMTP_USER= SMTP_PASS= RESEND_API_KEY= VAPID_PUBLIC_KEY= VAPID_PRIVATE_KEY= TELEGRAM_BOT_TOKEN= APP_URL=http://localhost:3100 npx next dev -p 3100
npm test && npx tsc --noEmit && npm run lint   # проверка перед коммитом
npx tsx --test src/lib/streak.test.ts   # один файл тестов
npm run build && npx next start -p 3100   # curl localhost:3100/api/health -> {"status":"ok"}
npx tsx scripts/scheduler-tick.ts --now=2026-10-10T16:00:00Z   # один тик планировщика, только против локальной БД
```

## Где что

- `src/lib/*.ts` + рядом `*.test.ts` — вся логика чистыми функциями; `npm test` берёт только `src/lib/*.test.ts`, `src/lib/analytics/*.test.ts`, `src/i18n/*.test.ts` (тест в другой папке не запустится)
- `src/app/api/**/route.ts` — API; страницы — `src/app/<раздел>/page.tsx`; общий слой запросов — `src/proxy.ts` (guard `/api/*`)
- `src/lib/scheduler/jobs/` — фоновые задачи; регистрировать в `jobs/index.ts`; уведомления — только через `notifyUsers` в `src/lib/notify.ts`
- `prisma/schema.prisma` + `prisma/migrations/` — схема; миграции идемпотентные, без `DROP` колонок с данными
- `src/i18n/messages/features/<slug>.ts` — строки UI новых фич (образец `_example.ts`); `ru.ts`/`en.ts` — только старые ключи, править оба
- `CONTEXT.md` — словарь терминов (в git; тренировка, баллы, день, серия — читать до кода)
- `docs/architecture.md` — поток данных, границы модулей, соглашения; `docs/adr/` — решения. Папка `docs/` ЛОКАЛЬНАЯ, в git не попадает (`.git/info/exclude`)
- Деплой — `./deploy.sh` с локальным `.deploy.env` (образец `.deploy.env.example`); без прямой просьбы не запускать

## Подводные камни

- Локальный `.env` содержит настоящий SMTP: в dev обнулять `SMTP_*`, `RESEND_API_KEY`, `VAPID_*`, `TELEGRAM_*` (как в команде выше), иначе уйдут реальные письма/пуши
- Планировщик стартует только при `SCHEDULER_ENABLED=1` (задан лишь в `docker-compose.prod.yml`); локально напоминаний нет — отладка через `scripts/scheduler-tick.ts`
- Небезопасные методы `/api/*` без заголовка Origin дают 403; для curl: `-H 'Origin: http://localhost:3100' -H 'Content-Type: application/json'`
- Баллы считать только через `calculateExercisePoints` (`src/lib/exercise-points.ts`); для дистанции значение в метрах
- День — календарный день в поясе пользователя (`src/lib/calendar-day.ts`), не `new Date()` и не UTC
- Владелец группы правит тренировки участников (`requireManagedGroupMemberAccess`, `?userId=&groupId=` в `/api/workouts`) — это фича, не баг
- Сессии хранятся хешем (`tokenHash`); искать по сырому `token` нельзя
- `next dev` дописывает `next-env.d.ts` и блок nextjs-agent-rules в этот файл; `next-env.d.ts` не коммитить
- При параллельных правках `next dev` (HMR) без конца перезагружает страницы; проверять UI на тихом дереве
- В `src/` лежат `*.bak*` — мусор, игнорируется git; не править
- Коммиты: `git add <пути>` явно, не `-A`; репозиторий публичный — ни IP, хостов, ключей, email, содержимого `.autopilot/`, `docs/`, `backups/`
- Откат релиза с миграцией сессий = образ + восстановление БД, одного образа мало

## Окружение

Образец — `.env.example`; значения не коммитить.

- `DATABASE_URL` — Postgres
- `APP_URL` — публичный адрес: Origin-guard, ссылки в письмах и сбросе пароля
- `NEXT_PUBLIC_APP_NAME` — имя приложения в UI
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `MAIL_FROM` — почта по SMTP
- `MAIL_PROVIDER` (`resend`|`smtp`), `RESEND_API_KEY` — почта через Resend
- `FEEDBACK_TO`, `FEEDBACK_PROJECT_LABEL` — получатель и метка писем обратной связи
- `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` — web push
- `SCHEDULER_ENABLED` — `1` включает фоновый планировщик (только прод)
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_API_BASE` — бот (без токена Telegram скрыт); вебхук ставит `scripts/telegram-set-webhook.ts`

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
