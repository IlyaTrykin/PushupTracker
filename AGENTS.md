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
NATIVE_API_BASE=http://localhost:3100 npm run cap:sync   # сборка интерфейса приложения + cap sync; iOS-симулятор
NATIVE_API_BASE=http://10.0.2.2:3100 npm run cap:sync   # то же для Android-эмулятора
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath /tmp/pushup-dd build
xcodebuild test -project ios/App/App.xcodeproj -scheme RepCounterTests -destination 'platform=iOS Simulator,name=iPhone 17'   # тесты счётчика повторений (Swift)
(cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=/opt/homebrew/share/android-commandlinetools ./gradlew assembleDebug test)   # APK + JUnit
adb install -r android/app/build/outputs/apk/debug/app-debug.apk && adb shell am start -n app.pushuptracker.mobile/.MainActivity   # monkey приложение не открывает
$ANDROID_HOME/emulator/emulator -avd pushup-api36 -no-window -no-audio &   # ANDROID_HOME как выше
npx tsx scripts/scheduler-tick.ts --now=2026-10-10T16:00:00Z   # один тик планировщика, только против локальной БД
```

## Где что

- `src/lib/*.ts` + рядом `*.test.ts` — вся логика чистыми функциями; `npm test` берёт только `src/lib/*.test.ts`, `src/lib/analytics/*.test.ts`, `src/lib/offline/*.test.ts`, `src/lib/health/*.test.ts`, `src/i18n/*.test.ts` (тест в другой папке не запустится)
- `src/app/api/**/route.ts` — API; страницы — `src/app/<раздел>/page.tsx`; общий слой запросов — `src/proxy.ts` (guard `/api/*`)
- `src/lib/scheduler/jobs/` — фоновые задачи; регистрировать в `jobs/index.ts`; уведомления — только через `notifyUsers` в `src/lib/notify.ts`
- `prisma/schema.prisma` + `prisma/migrations/` — схема; миграции идемпотентные, без `DROP` колонок с данными
- `src/i18n/messages/features/<slug>.ts` — строки UI новых фич (образец `_example.ts`); `ru.ts`/`en.ts` — только старые ключи, править оба
- `CONTEXT.md` — словарь терминов (в git; тренировка, баллы, день, серия — читать до кода)
- Приложения iOS/Android (Capacitor 8, `appId app.pushuptracker.mobile`): интерфейс встроен в бандл (`BUILD_TARGET=native`, `output: 'export'` → `out/`), маршруты — `src/app/**/page.native.tsx` + `src/app/layout.native.tsx`; веб их не видит. Нативные проекты — `ios/App`, `android/`; конфиг — `capacitor.config.ts`; сборка — `scripts/build-native.mjs`
- Приложение: `src/lib/platform.ts` (isNativeApp, apiBase, hardNavigate), `src/lib/app-routes.ts` (ссылки/`toAppRoute`), `src/lib/native-fetch.ts` + `native-auth.ts` (Bearer-мост, токен в Keychain/EncryptedSharedPreferences), `src/lib/cors.ts`, `src/lib/offline/` (очередь тренировок, фоновая отправка), `src/lib/health/` + `src/app/api/health/` (Apple Health / Health Connect), `src/lib/rep-counter.ts` (счёт повторений), `src/lib/native-push.ts` + `native-push-client.ts` + `src/app/api/push/devices` (APNs/FCM)
- Нативные плагины: iOS `ios/App/App/Plugins/*.swift` (регистрация в `MainViewController.swift`), Android `android/app/src/main/java/app/pushuptracker/mobile/plugins/*.kt` (регистрация в `MainActivity.java`): SecureToken, BackgroundUpload, HealthBridge, RepCounter, PushConfig (только Android)
- Строки UI приложения — `src/i18n/messages/features/native-app.ts`
- `docs/architecture.md` — поток данных (в т.ч. раздел «Приложения iOS/Android»), границы модулей, соглашения; `docs/adr/` — решения. Папка `docs/` ЛОКАЛЬНАЯ, в git не попадает (`.git/info/exclude`)
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
- Приложение: внутренние пути не открывать через `window.location.href` (Capacitor отдаёт корневой index.html) — только роутер или `hardNavigate` (`src/lib/platform.ts`)
- Ссылки на группы/челленджи/программы/сессии — только через `src/lib/app-routes.ts` (в приложении `/groups/view?id=`, не `/groups/<id>`); `Notification.link` с сервера переводится `toAppRoute`
- `npm run build:native` откладывает сайтовый `.next` в `tmp/next-web-stash`; не запускать параллельно с `npm run build`; после прерывания вернуть `tmp/next-web-stash` в `.next`
- Новый Swift-файл плагина — добавить в `ios/App/App.xcodeproj/project.pbxproj` вручную, иначе не соберётся
- Android: Health Connect → minSdk приложения 26 (`android/app/build.gradle`, общий в `android/variables.gradle` — 24); `register()` пушей без `google-services.json` роняет приложение — `native-push-client.ts` проверяет, что сборка с Firebase-конфигом
- Адрес сервера — только env `NATIVE_API_BASE` при сборке, в файлы не писать (репозиторий публичный); cleartext (Android) и ATS-исключение (iOS) — только в debug
- `loggingBehavior: 'none'` в `capacitor.config.ts` не убирать: без него мост пишет токен в консоль WebView/logcat
- Кросс-доменные запросы приложения: `Retry-After` виден JS только через `Access-Control-Expose-Headers` (`src/lib/cors.ts`); Bearer без cookie обходит Origin-проверку (`src/lib/request-guard.ts`)
- Для приложения `/api/login` с `X-Client: native` отдаёт токен в теле (сессия 180 дней), cookie не ставит
- `npx tsx scripts/seed-demo.ts` падает FK-ошибкой, если demo уже есть — вход demo / demo123 при этом работает
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
- `NATIVE_API_BASE` — адрес сервера, вшиваемый в сборку приложения (`npm run build:native` / `cap:sync`)
- `NATIVE_APP_ORIGINS` — разрешённые CORS-origin приложений; пусто = `capacitor://localhost` и `https://localhost`
- `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, `APNS_BUNDLE_ID`, `APNS_PRODUCTION` — пуши iOS через APNs (`APNS_PRODUCTION=1` — боевой APNs); пусто — канал выключен
- `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`, `FCM_PRIVATE_KEY` — пуши Android через FCM HTTP v1; пусто — канал выключен
- `ANDROID_APP_PACKAGE`, `ANDROID_CERT_SHA256` — `/.well-known/assetlinks.json` (App Links); `APPLE_TEAM_ID`, `APPLE_BUNDLE_ID` — `/.well-known/apple-app-site-association`; пусто — 404
- `LEGAL_OPERATOR_NAME`, `LEGAL_CONTACT_EMAIL` — оператор и контакт на `/privacy`, `/terms`, `/support`, `/account-deletion`; значения только в env сервера (репозиторий публичный), пусто — видимая заглушка
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
