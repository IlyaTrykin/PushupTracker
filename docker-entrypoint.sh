#!/bin/sh
# Запускается от root: делает том аватаров (/app/public/uploads) доступным
# пользователю node и сбрасывает привилегии до node для основной команды.
set -eu

UPLOADS_DIR=/app/public/uploads

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOADS_DIR"
  chown -R node:node "$UPLOADS_DIR"
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node "$@"
fi

exec "$@"
