#!/usr/bin/env bash
# Nightly backup of the database and uploaded images. Add to cron:
#   0 2 * * *  cd /opt/dsrj-canteen && ./scripts/backup.sh >> /var/log/dsrj-backup.log 2>&1
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/dsrj-backups}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
STAMP="$(date +%Y%m%d-%H%M%S)"
COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production"

mkdir -p "$BACKUP_DIR"

echo "==> Dumping database"
$COMPOSE exec -T postgres pg_dump -U "${POSTGRES_USER:-dsrj}" "${POSTGRES_DB:-dsrj_canteen}" \
  | gzip > "$BACKUP_DIR/db-$STAMP.sql.gz"

echo "==> Archiving uploaded images"
docker run --rm -v dsrj-canteen_dsrj_uploads:/data -v "$BACKUP_DIR":/backup alpine \
  tar czf "/backup/uploads-$STAMP.tar.gz" -C /data . || echo "(no uploads volume yet)"

echo "==> Pruning backups older than $RETENTION_DAYS days"
find "$BACKUP_DIR" -name '*.gz' -mtime +"$RETENTION_DAYS" -delete

echo "✅ Backup complete → $BACKUP_DIR"
