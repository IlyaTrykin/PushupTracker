#!/usr/bin/env bash
set -euo pipefail
umask 027

cd /opt/pushup-tracker
TS=$(date +%Y%m%d_%H%M%S)
OUT="/opt/pushup-tracker/db_backups/pushup_tracker_${TS}.sql.gz"

docker compose exec -T db pg_dump -U postgres -d pushup_tracker | gzip > "$OUT"

# owner/group for pull-user
chown backup:pushup_backups "$OUT"
chmod 640 "$OUT"

# права/группа на всякий случай

# хранить только 14 дней
find /opt/pushup-tracker/db_backups -type f -name 'pushup_tracker_*.sql.gz' -mtime +7 -delete
