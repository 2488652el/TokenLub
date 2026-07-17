#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${TOKENLUB_INSTALL_DIR:-/opt/tokenlub}"
SOURCE_DIR="${TOKENLUB_SOURCE_DIR:-$INSTALL_DIR/source}"
SSH_ONLY="${TOKENLUB_SSH_ONLY:-0}"
PROJECT_NAME="${TOKENLUB_PROJECT_NAME:-tokenlub}"
COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server.yml"
[[ "$SSH_ONLY" == 1 ]] && COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server-ssh.yml"
ENV_FILE="$INSTALL_DIR/.env"

for attempt in $(seq 1 60); do
  if docker compose \
    --project-name "$PROJECT_NAME" \
    --project-directory "$SOURCE_DIR" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(async r => { if (!r.ok) process.exit(1); console.log(await r.text()) }).catch(() => process.exit(1))"; then
    exit 0
  fi
  sleep 2
done

exit 1
