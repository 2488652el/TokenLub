#!/usr/bin/env bash
set -Eeuo pipefail

INSTALL_DIR="${TOKENLUB_INSTALL_DIR:-/opt/tokenlub}"
BACKUP_DIR="${TOKENLUB_BACKUP_DIR:-$INSTALL_DIR/backups}"
RETENTION="${TOKENLUB_BACKUP_RETENTION:-14}"
MIN_FREE_MB="${MIN_FREE_MB:-1024}"
SOURCE_DIR="${TOKENLUB_SOURCE_DIR:-$INSTALL_DIR/source}"
SSH_ONLY="${TOKENLUB_SSH_ONLY:-0}"
PROJECT_NAME="${TOKENLUB_PROJECT_NAME:-tokenlub}"
COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server.yml"
[[ "$SSH_ONLY" == 1 ]] && COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server-ssh.yml"
ENV_FILE="$INSTALL_DIR/.env"

die() {
  printf '备份失败：%s\n' "$*" >&2
  exit 1
}

[[ "${EUID}" -eq 0 ]] || die '请使用 sudo 或 root 执行备份。'
[[ -f "$ENV_FILE" ]] || die "找不到配置文件：$ENV_FILE"
[[ -f "$COMPOSE_FILE" ]] || die "找不到生产 Compose：$COMPOSE_FILE"
[[ "$RETENTION" =~ ^[1-9][0-9]*$ ]] || die 'TOKENLUB_BACKUP_RETENTION 必须是正整数。'
[[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || die 'MIN_FREE_MB 必须是非负整数。'

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
available_kb="$(df -Pk "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')"
[[ "$available_kb" =~ ^[0-9]+$ ]] || die '无法读取备份目录剩余空间。'
(( available_kb / 1024 >= MIN_FREE_MB )) || die "备份目录剩余空间低于 ${MIN_FREE_MB} MB。"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/tokenlub-$timestamp.dump"
umask 077

docker compose \
  --project-name "$PROJECT_NAME" \
  --project-directory "$SOURCE_DIR" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  exec -T db sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > "$output"

[[ -s "$output" ]] || die 'pg_dump 生成了空文件。'

find "$BACKUP_DIR" -maxdepth 1 -type f -name 'tokenlub-*.dump' -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +$((RETENTION + 1)) \
  | cut -d' ' -f2- \
  | while IFS= read -r old_backup; do
      [[ -n "$old_backup" ]] && rm -f -- "$old_backup"
    done

printf '备份完成：%s\n' "$output"
