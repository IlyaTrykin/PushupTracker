#!/bin/sh
# Запускается от root: делает тома аватаров (/app/public/uploads) и загрузок (/app/downloads)
# доступными пользователю node и сбрасывает привилегии до node для основной команды.
set -eu

UPLOADS_DIR=/app/public/uploads
DOWNLOADS_DIR=/app/downloads

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOADS_DIR" "$DOWNLOADS_DIR"
  chown -R node:node "$UPLOADS_DIR" "$DOWNLOADS_DIR"
  exec setpriv --reuid=node --regid=node --init-groups env HOME=/home/node "$@"
fi

exec "$@"
