#!/usr/bin/env sh
set -eu

: "${DUMP_FILE:=${1:-}}"
: "${DUMP_FILE:?usage: DUMP_FILE=/path/to/dump ./ops/restore-postgres-rehearsal.sh}"
PROJECT=${RESTORE_PROJECT:-tokenlub-restore}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}

[ -f "$DUMP_FILE" ] || { printf '%s\n' "dump not found: $DUMP_FILE" >&2; exit 1; }

cleanup() {
  if [ "${KEEP_RESTORE_DB:-0}" != 1 ]; then
    docker compose -p "$PROJECT" -f "$COMPOSE_FILE" down -v
  fi
}
trap cleanup EXIT INT TERM

docker compose -p "$PROJECT" -f "$COMPOSE_FILE" up -d --wait --wait-timeout 60 db
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore --clean --if-exists --no-owner \
   -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DUMP_FILE"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
   -tAc "SELECT COUNT(*) FROM users"'
