#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

case "${1:-}" in
  backup)
    exec bash "$SCRIPT_DIR/backup.sh" "${@:2}"
    ;;
  upgrade)
    exec bash "$SCRIPT_DIR/upgrade.sh" "${@:2}"
    ;;
  uninstall)
    exec bash "$SCRIPT_DIR/uninstall.sh" "${@:2}"
    ;;
  logs)
    INSTALL_DIR="${TOKENLUB_INSTALL_DIR:-/opt/tokenlub}"
    SOURCE_DIR="${TOKENLUB_SOURCE_DIR:-$INSTALL_DIR/source}"
    SSH_ONLY="${TOKENLUB_SSH_ONLY:-0}"
    PROJECT_NAME="${TOKENLUB_PROJECT_NAME:-tokenlub}"
    COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server.yml"
    [[ "$SSH_ONLY" == 1 ]] && COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server-ssh.yml"
    exec docker compose --project-name "$PROJECT_NAME" --project-directory "$SOURCE_DIR" --env-file "$INSTALL_DIR/.env" -f "$COMPOSE_FILE" logs -f --tail=200
    ;;
  health)
    exec bash "$SCRIPT_DIR/healthcheck.sh" "${@:2}"
    ;;
  *)
    cat >&2 <<'EOF'
用法：tokenlub-sync {backup|upgrade|uninstall|logs|health}
EOF
    exit 2
    ;;
esac
