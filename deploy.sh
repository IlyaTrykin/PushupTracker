#!/usr/bin/env bash
set -euo pipefail

# Деплой на VPS, где pushup живёт изолированным соседом за чужим Caddy:
# свой Caddy не поднимаем, порты наружу не публикуем.
# REMOTE_DIR — это rsync-приёмник, а НЕ git-checkout.
#
# Адрес сервера, ключ и URL проверки здоровья НЕ хранятся в репозитории:
# они читаются из локального .deploy.env (в .gitignore; образец — .deploy.env.example).
#   DEPLOY_HOST   — user@host сервера (обязательно)
#   DEPLOY_KEY    — путь к ssh-ключу (необязательно; иначе ssh-agent/ssh_config)
#   HEALTH_URL    — публичный URL /api/health (обязательно)
#   REMOTE_DIR    — каталог на сервере (по умолчанию /root/pushup-tracker)
#   COMPOSE_FILE  — compose-файл (по умолчанию docker-compose.prod.yml)
# Любую переменную можно переопределить окружением: DEPLOY_HOST=… ./deploy.sh
cd "$(dirname "$0")"

DEPLOY_ENV_FILE="${DEPLOY_ENV_FILE:-.deploy.env}"
if [[ -f "${DEPLOY_ENV_FILE}" ]]; then
  # shellcheck disable=SC1090
  case "${DEPLOY_ENV_FILE}" in /*) ;; *) DEPLOY_ENV_FILE="./${DEPLOY_ENV_FILE#./}" ;; esac
  set -a; . "${DEPLOY_ENV_FILE}"; set +a
fi

if [[ -z "${DEPLOY_HOST:-}" ]]; then
  echo "deploy.sh: не задан DEPLOY_HOST (user@host сервера)." >&2
  echo "Создайте ${DEPLOY_ENV_FILE} по образцу .deploy.env.example или передайте переменную окружением." >&2
  exit 1
fi
if [[ -z "${HEALTH_URL:-}" ]]; then
  echo "deploy.sh: не задан HEALTH_URL (публичный адрес /api/health) — см. .deploy.env.example." >&2
  exit 1
fi

SERVER="${DEPLOY_HOST}"
REMOTE_DIR="${REMOTE_DIR:-/root/pushup-tracker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
SSH_KEY="${DEPLOY_KEY:-}"
if [[ -n "${SSH_KEY}" ]]; then
  SSH_KEY="${SSH_KEY/#\~/${HOME}}"
  if [[ ! -f "${SSH_KEY}" ]]; then
    echo "deploy.sh: DEPLOY_KEY указывает на несуществующий файл." >&2
    exit 1
  fi
fi

# Версия сборки для /api/version и service worker'а.
GIT_SHA="$(git rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
if [[ -n "$(git status --porcelain 2>/dev/null)" ]]; then
  GIT_SHA="${GIT_SHA}-dirty"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY}" ]]; then
  SSH_OPTS+=(-i "${SSH_KEY}")
  SSH_OPTS+=(-o IdentitiesOnly=yes)
fi

SSH_CMD=(ssh "${SSH_OPTS[@]}")
RSYNC_RSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
  RSYNC_RSH+=" ${opt}"
done

echo "[1/4] Sync project -> ${REMOTE_DIR} (build ${GIT_SHA})"

# Без --delete: на сервере есть каталоги, которых нет в репозитории (logs/,
# смонтированный public/uploads), и сносить их деплоем нельзя.
# .env исключён намеренно — рантайм-секреты живут только на сервере.
rsync -az --info=stats1 \
  -e "${RSYNC_RSH}" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude '.deploy.env' \
  --exclude '.autopilot' \
  --exclude 'docs' \
  --exclude 'backups' \
  --exclude 'Backups' \
  --exclude 'tmp' \
  --exclude 'output' \
  --exclude 'test-results' \
  --exclude 'import' \
  --exclude '*.tgz' \
  --exclude '*.sql.gz' \
  --exclude '*.dump' \
  --exclude '*.tsbuildinfo' \
  --exclude '.DS_Store' \
  --exclude 'android' \
  --exclude 'ios' \
  --exclude 'out' \
  --exclude '.next-native' \
  --exclude '/downloads' \
  --exclude '*.apk' \
  --exclude '*.aab' \
  ./ "${SERVER}:${REMOTE_DIR}/"

echo "[2/4] Build web image on server (GIT_SHA=${GIT_SHA}, BUILD_TIME=${BUILD_TIME})"
"${SSH_CMD[@]}" "${SERVER}" "set -e; cd '${REMOTE_DIR}'; \
  GIT_SHA='${GIT_SHA}' BUILD_TIME='${BUILD_TIME}' docker compose -f '${COMPOSE_FILE}' build web"

# Миграции применяет сам контейнер: CMD образа делает prisma migrate deploy
# перед next start, поэтому отдельного шага здесь нет.
echo "[3/4] Recreate web container"
"${SSH_CMD[@]}" "${SERVER}" "set -e; cd '${REMOTE_DIR}'; \
  GIT_SHA='${GIT_SHA}' BUILD_TIME='${BUILD_TIME}' docker compose -f '${COMPOSE_FILE}' up -d --force-recreate web"

echo "[4/4] Health check ${HEALTH_URL}"
for attempt in $(seq 1 12); do
  if body="$(curl -fsS --max-time 10 "${HEALTH_URL}" 2>/dev/null)"; then
    echo "${body}"
    echo "Done"
    exit 0
  fi
  echo "  not ready yet (${attempt}/12), retrying in 5s…"
  sleep 5
done

echo "Health check failed: ${HEALTH_URL}" >&2
"${SSH_CMD[@]}" "${SERVER}" "docker logs pushup-web --tail 40 2>&1" >&2 || true
exit 1
