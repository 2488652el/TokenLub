#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${TOKENLUB_INSTALL_DIR:-/opt/tokenlub}"
SOURCE_DIR="${TOKENLUB_SOURCE_DIR:-$INSTALL_DIR/source}"
REPO_REF="${TOKENLUB_REPO_REF:-main}"
ARCHIVE=""
ENV_FILE="$INSTALL_DIR/.env"
SSH_ONLY="${TOKENLUB_SSH_ONLY:-0}"
PROJECT_NAME="${TOKENLUB_PROJECT_NAME:-tokenlub}"
COMPOSE_FILE="$SOURCE_DIR/docker-compose.server.yml"
[[ "$SSH_ONLY" == 1 ]] && COMPOSE_FILE="$SOURCE_DIR/docker-compose.server-ssh.yml"
export TOKENLUB_INSTALL_DIR="$INSTALL_DIR"
export TOKENLUB_SOURCE_DIR="$SOURCE_DIR"
export TOKENLUB_SSH_ONLY="$SSH_ONLY"
export TOKENLUB_PROJECT_NAME="$PROJECT_NAME"

die() {
  printf '升级失败：%s\n' "$*" >&2
  exit 1
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --archive)
      [[ $# -ge 2 ]] || die '--archive 缺少参数。'
      ARCHIVE="$2"
      shift 2
      ;;
    *)
      die "未知参数：$1"
      ;;
  esac
done

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --project-directory "$SOURCE_DIR" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" "$@"
}

[[ "${EUID}" -eq 0 ]] || die '请使用 sudo 或 root 执行升级。'
[[ -f "$ENV_FILE" ]] || die "找不到配置文件：$ENV_FILE"
if [[ ! -d "$SOURCE_DIR/.git" ]]; then
  [[ -n "$ARCHIVE" ]] || die "源码目录不是 Git 仓库，请使用 --archive /path/to/tokenlub.tgz：$SOURCE_DIR"
  [[ -f "$ARCHIVE" ]] || die "升级包不存在：$ARCHIVE"
fi

bash "$SOURCE_DIR/ops/one-click/backup.sh"
previous_commit='archive'
source_backup=''
if [[ -d "$SOURCE_DIR/.git" ]]; then
  previous_commit="$(git -C "$SOURCE_DIR" rev-parse HEAD)"
  git -C "$SOURCE_DIR" fetch --depth 1 origin "$REPO_REF"
  git -C "$SOURCE_DIR" checkout --force FETCH_HEAD
else
  source_backup="$INSTALL_DIR/backups/tokenlub-source-pre-upgrade-$(date -u +%Y%m%dT%H%M%SZ).tgz"
  tar -czf "$source_backup" -C "$SOURCE_DIR" --exclude='.env' --exclude='backups' --exclude='Caddyfile' .
  tar -xzf "$ARCHIVE" -C "$SOURCE_DIR" --exclude='.env' --exclude='backups' --exclude='Caddyfile' --overwrite
fi

if compose up -d --build && bash "$SOURCE_DIR/ops/one-click/healthcheck.sh"; then
  if [[ -d "$SOURCE_DIR/.git" ]]; then
    printf '升级完成：%s -> %s\n' "$previous_commit" "$(git -C "$SOURCE_DIR" rev-parse HEAD)"
  else
    printf '升级完成：已应用压缩包 %s\n源码回滚包：%s\n' "$ARCHIVE" "$source_backup"
  fi
  exit 0
fi

printf '新版本健康检查失败，正在回滚到 %s。\n' "$previous_commit" >&2
if [[ -d "$SOURCE_DIR/.git" ]]; then
  git -C "$SOURCE_DIR" checkout --force "$previous_commit"
else
  find "$SOURCE_DIR" -mindepth 1 -maxdepth 1 \
    ! -name '.env' ! -name 'backups' ! -name 'Caddyfile' \
    -exec rm -rf -- {} +
  tar -xzf "$source_backup" -C "$SOURCE_DIR" --overwrite
fi
compose up -d --build || true
die '升级失败，已恢复旧版本代码；请检查容器日志。'
