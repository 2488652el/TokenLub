#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${TOKENLUB_INSTALL_DIR:-/opt/tokenlub}"
SOURCE_DIR="${TOKENLUB_SOURCE_DIR:-$INSTALL_DIR/source}"
SSH_ONLY="${TOKENLUB_SSH_ONLY:-0}"
PROJECT_NAME="${TOKENLUB_PROJECT_NAME:-tokenlub}"
COMPOSE_FILE="$SOURCE_DIR/docker-compose.server.yml"
[[ "$SSH_ONLY" == 1 ]] && COMPOSE_FILE="$SOURCE_DIR/docker-compose.server-ssh.yml"
ENV_FILE="$INSTALL_DIR/.env"
PURGE=0

die() {
  printf '卸载失败：%s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE=1
      shift
      ;;
    --yes)
      shift
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

[[ "${EUID}" -eq 0 ]] || die '请使用 sudo 或 root 执行卸载。'
[[ -f "$ENV_FILE" ]] || die "找不到配置文件：$ENV_FILE"

docker compose \
  --project-name "$PROJECT_NAME" \
  --project-directory "$SOURCE_DIR" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" down

if [[ "$PURGE" -eq 1 ]]; then
  [[ "$INSTALL_DIR" == /opt/tokenlub || "$INSTALL_DIR" == /opt/tokenlub/* ]] || \
    die '--purge 只允许删除 /opt/tokenlub 下的部署目录。'
  docker compose \
    --project-name "$PROJECT_NAME" \
    --project-directory "$SOURCE_DIR" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" down --volumes
  rm -rf -- "$INSTALL_DIR"
  rm -f -- /usr/local/bin/tokenlub-sync
  printf 'TokenLub 已卸载，数据卷和部署目录已删除。\n'
else
  printf 'TokenLub 容器已停止，数据和部署目录保留在：%s\n' "$INSTALL_DIR"
  printf '如确认删除全部数据库数据，请再次执行：sudo tokenlub-sync uninstall --purge --yes\n'
fi
