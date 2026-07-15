#!/usr/bin/env sh
set -eu
umask 077

: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR=${BACKUP_DIR:-./backups}
mkdir -p "$BACKUP_DIR"
MIN_FREE_MB=${MIN_FREE_MB:-1024}
available_kb=$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')
if [ -z "$available_kb" ] || [ "$available_kb" -lt "$((MIN_FREE_MB * 1024))" ]; then
  printf '%s\n' "insufficient backup disk space" >&2
  exit 1
fi
backup="$BACKUP_DIR/tokenlub-$(date -u +%Y%m%dT%H%M%SZ).dump"
pg_dump --format=custom --no-owner --file="$backup" "$DATABASE_URL"
printf '%s\n' "$backup"
