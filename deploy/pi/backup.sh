#!/usr/bin/env bash
set -euo pipefail

SUPABASE_DIR=${SUPABASE_DIR:-/srv/teachnotes/supabase}
BACKUP_DIR=${BACKUP_DIR:-/srv/teachnotes/backups}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DESTINATION="$BACKUP_DIR/$STAMP"

umask 077
mkdir -p "$DESTINATION"

cd "$SUPABASE_DIR"
docker compose exec -T db pg_dump \
  --username postgres \
  --dbname postgres \
  --format custom \
  --no-owner \
  --no-privileges > "$DESTINATION/postgres.dump"

tar -C "$SUPABASE_DIR" -czf "$DESTINATION/storage.tar.gz" volumes/storage
sha256sum "$DESTINATION/postgres.dump" "$DESTINATION/storage.tar.gz" > "$DESTINATION/SHA256SUMS"

printf 'TeachNotes backup completed: %s\n' "$DESTINATION"
