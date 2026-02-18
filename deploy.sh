#!/usr/bin/env bash
set -euo pipefail

SERVER="root@45.89.228.79"
REMOTE_DIR="/opt/pushup-tracker"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/pushup_tracker_ed25519}"

echo "[1/4] Sync project -> ${SERVER}:${REMOTE_DIR}"

rsync -avz --delete \
  -e "ssh -i ${SSH_KEY} -o StrictHostKeyChecking=accept-new" \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude '*.dump' \
  --exclude '*.sql' \
  --exclude 'Backups' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude '.env.runtime' \
  ./ "${SERVER}:${REMOTE_DIR}/"

echo "[2/4] Build and restart on server"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${SERVER}" "set -e; cd '${REMOTE_DIR}'; \
  docker compose pull || true; \
  docker compose build --no-cache web; \
  docker compose up -d --force-recreate web caddy; \
  docker compose exec -T web npx prisma migrate deploy"

echo "[3/4] Health check"
ssh -i "${SSH_KEY}" -o StrictHostKeyChecking=accept-new "${SERVER}" "set -e; \
  curl -fsS http://127.0.0.1:3000/api/health | head -c 300; echo"

echo "[4/4] Done"
