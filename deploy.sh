#!/usr/bin/env bash
set -euo pipefail

SERVER="${SERVER:-ssh.trykin.online}"
REMOTE_DIR="${REMOTE_DIR:-/home/ilya/pushup-tracker}"
# Optional. For Cloudflare SSH host aliases in ~/.ssh/config, leave empty.
SSH_KEY="${SSH_KEY:-}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY}" ]]; then
  SSH_OPTS+=(-i "${SSH_KEY}")
fi

SSH_CMD=(ssh "${SSH_OPTS[@]}")
RSYNC_RSH="ssh"
for opt in "${SSH_OPTS[@]}"; do
  RSYNC_RSH+=" ${opt}"
done

echo "[1/4] Sync project -> ${SERVER}:${REMOTE_DIR}"

rsync -avz --delete \
  -e "${RSYNC_RSH}" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '*.dump' \
  --exclude '*.sql.gz' \
  --exclude 'backups' \
  --exclude 'Backups' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude '.env.runtime' \
  ./ "${SERVER}:${REMOTE_DIR}/"

echo "[2/4] Build and restart on server"
"${SSH_CMD[@]}" "${SERVER}" "set -e; cd '${REMOTE_DIR}'; \
  docker compose pull || true; \
  docker compose build --no-cache web; \
  docker compose up -d --force-recreate web caddy; \
  docker compose exec -T web npx prisma migrate deploy"

echo "[3/4] Health check"
"${SSH_CMD[@]}" "${SERVER}" "set -e; \
  curl -fsS http://127.0.0.1:3000/api/health | head -c 300; echo"

echo "[4/4] Done"
