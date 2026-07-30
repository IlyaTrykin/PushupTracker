#!/usr/bin/env bash
set -euo pipefail

# Деплой на VPS 37.252.23.144, где pushup живёт изолированным соседом за
# teammanager-caddy: свой Caddy не поднимаем, порты наружу не публикуем.
# /root/pushup-tracker — это rsync-приёмник, а НЕ git-checkout.
#
# Переопределяется через окружение:
#   SERVER=root@1.2.3.4 ./deploy.sh
#   REMOTE_DIR=/root/pushup-tracker ./deploy.sh
#   SSH_KEY=~/.ssh/other ./deploy.sh
SERVER="${SERVER:-root@37.252.23.144}"
REMOTE_DIR="${REMOTE_DIR:-/root/pushup-tracker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
HEALTH_URL="${HEALTH_URL:-https://tracker.trykin.online/api/health}"

# Ключ проекта, если он есть локально; иначе полагаемся на ssh-agent/ssh_config.
DEFAULT_SSH_KEY="${HOME}/.ssh/ilyatrykin"
SSH_KEY="${SSH_KEY:-}"
if [[ -z "${SSH_KEY}" && -f "${DEFAULT_SSH_KEY}" ]]; then
  SSH_KEY="${DEFAULT_SSH_KEY}"
fi

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

echo "[1/4] Sync project -> ${SERVER}:${REMOTE_DIR} (HEAD $(git rev-parse --short HEAD 2>/dev/null || echo '?'))"

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
  ./ "${SERVER}:${REMOTE_DIR}/"

echo "[2/4] Build web image on server"
"${SSH_CMD[@]}" "${SERVER}" "set -e; cd '${REMOTE_DIR}'; \
  docker compose -f '${COMPOSE_FILE}' build web"

# Миграции применяет сам контейнер: CMD образа делает prisma migrate deploy
# перед next start, поэтому отдельного шага здесь нет.
echo "[3/4] Recreate web container"
"${SSH_CMD[@]}" "${SERVER}" "set -e; cd '${REMOTE_DIR}'; \
  docker compose -f '${COMPOSE_FILE}' up -d --force-recreate web"

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
