#!/usr/bin/env bash
# Дамп БД pushup-tracker на сервере (прод-топология: каталог /root/pushup-tracker,
# стек docker-compose.prod.yml, сервис db). Имя БД и пользователь берутся из
# окружения контейнера db (POSTGRES_DB / POSTGRES_USER из серверного .env).
#
# Аватары (том uploads) этим скриптом не сохраняются — их бэкап отдельный.
# Дампы не шифруются: каталог закрыт правами 700, файлы — 640.
set -euo pipefail
umask 027

PROJECT_DIR="${PROJECT_DIR:-/root/pushup-tracker}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
BACKUP_DIR="${BACKUP_DIR:-${PROJECT_DIR}/db_backups}"
# Срок хранения дампов, в днях.
RETENTION_DAYS="${RETENTION_DAYS:-14}"
# Необязательно: владелец файлов дампа для pull-пользователя, формат user:group.
BACKUP_OWNER="${BACKUP_OWNER:-}"

cd "${PROJECT_DIR}"
mkdir -p "${BACKUP_DIR}"
chmod 700 "${BACKUP_DIR}"

TS="$(date +%Y%m%d_%H%M%S)"
OUT="${BACKUP_DIR}/pushup_tracker_${TS}.sql.gz"
TMP="${OUT}.partial"
trap 'rm -f "${TMP}"' EXIT

docker compose -f "${COMPOSE_FILE}" exec -T db \
  sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' | gzip > "${TMP}"
gzip -t "${TMP}"
mv "${TMP}" "${OUT}"
chmod 640 "${OUT}"

if [[ -n "${BACKUP_OWNER}" ]]; then
  chown "${BACKUP_OWNER}" "${OUT}"
fi

# Хранить RETENTION_DAYS дней: удаляются дампы старше этого срока.
find "${BACKUP_DIR}" -type f -name 'pushup_tracker_*.sql.gz' -mtime +"$((RETENTION_DAYS - 1))" -delete

echo "${OUT}"
