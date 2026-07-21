#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_REPO_URL="https://github.com/2488652el/MoonMeter.git"
INSTALL_DIR="${TOKENLUB_INSTALL_DIR:-/opt/tokenlub}"
REPO_URL="${TOKENLUB_REPO_URL:-$DEFAULT_REPO_URL}"
REPO_REF="${TOKENLUB_REPO_REF:-main}"
SOURCE_DIR="${TOKENLUB_SOURCE_DIR:-}"
DOMAIN="${TOKENLUB_DOMAIN:-}"
ACME_EMAIL="${ACME_EMAIL:-}"
ADMIN_EMAIL="${ADMIN_EMAIL:-}"
SSH_ONLY="${TOKENLUB_SSH_ONLY:-0}"
PROJECT_NAME="${TOKENLUB_PROJECT_NAME:-tokenlub}"
COMPOSE_FILE=""

usage() {
  cat <<'EOF'
TokenLub server installer

Usage:
  sudo bash install.sh --domain sync.example.com --email admin@example.com

Options:
  --domain NAME       Public DNS name used for HTTPS (required)
  --email ADDRESS     Email used by Caddy for certificate notices (required)
  --ssh-only          Keep the service on 127.0.0.1 for an SSH tunnel; do not start Caddy
  --project-name NAME Compose project name (default: tokenlub)
  --admin-email ADDR  Optional TokenLub admin account email
  --install-dir PATH  Deployment directory (default: /opt/tokenlub)
  --repo-url URL      Git repository to clone when no local source is supplied
  --ref REF           Git branch or tag to deploy (default: main)
  --source-dir PATH   Use an existing TokenLub checkout instead of cloning
  --help              Show this help
EOF
}

die() {
  printf '安装失败：%s\n' "$*" >&2
  exit 1
}

log() {
  printf '[tokenlub] %s\n' "$*"
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || die '请使用 sudo 或 root 执行安装脚本。'
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --domain)
        [[ $# -ge 2 ]] || die '--domain 缺少参数。'
        DOMAIN="$2"
        shift 2
        ;;
      --email)
        [[ $# -ge 2 ]] || die '--email 缺少参数。'
        ACME_EMAIL="$2"
        shift 2
        ;;
      --ssh-only)
        SSH_ONLY=1
        shift
        ;;
      --project-name)
        [[ $# -ge 2 ]] || die '--project-name 缺少参数。'
        PROJECT_NAME="$2"
        shift 2
        ;;
      --admin-email)
        [[ $# -ge 2 ]] || die '--admin-email 缺少参数。'
        ADMIN_EMAIL="$2"
        shift 2
        ;;
      --install-dir)
        [[ $# -ge 2 ]] || die '--install-dir 缺少参数。'
        INSTALL_DIR="$2"
        shift 2
        ;;
      --repo-url)
        [[ $# -ge 2 ]] || die '--repo-url 缺少参数。'
        REPO_URL="$2"
        shift 2
        ;;
      --ref)
        [[ $# -ge 2 ]] || die '--ref 缺少参数。'
        REPO_REF="$2"
        shift 2
        ;;
      --source-dir)
        [[ $# -ge 2 ]] || die '--source-dir 缺少参数。'
        SOURCE_DIR="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "未知参数：$1"
        ;;
    esac
  done
}

validate_inputs() {
  [[ "$SSH_ONLY" == 0 || "$SSH_ONLY" == 1 ]] || die 'TOKENLUB_SSH_ONLY 必须是 0 或 1。'
  if [[ "$SSH_ONLY" == 0 ]]; then
    [[ -n "$DOMAIN" ]] || die '必须提供 --domain。公网部署需要域名才能自动申请 HTTPS 证书。'
    [[ -n "$ACME_EMAIL" ]] || die '必须提供 --email。'
    [[ "$DOMAIN" =~ ^[A-Za-z0-9][A-Za-z0-9.-]*[A-Za-z0-9]$ ]] || die "域名格式无效：$DOMAIN"
    [[ "$ACME_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] || die "邮箱格式无效：$ACME_EMAIL"
  fi
  [[ "$INSTALL_DIR" = /* ]] || die '--install-dir 必须是绝对路径。'
  [[ "$PROJECT_NAME" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die "Compose 项目名格式无效：$PROJECT_NAME"
}

check_os() {
  [[ -r /etc/os-release ]] || die '无法读取 /etc/os-release。'
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "${ID:-}" == 'ubuntu' ]] || die "第一期仅支持 Ubuntu，当前系统：${ID:-unknown}"
  [[ "${VERSION_ID:-}" == '22.04' || "${VERSION_ID:-}" == '24.04' ]] || \
    die "第一期支持 Ubuntu 22.04/24.04，当前版本：${VERSION_ID:-unknown}"
}

install_runtime() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
    return
  fi

  log '正在安装 Docker 和 Compose plugin。'
  apt-get update
  if ! apt-get install -y ca-certificates curl git openssl docker.io docker-compose-plugin; then
    apt-get install -y ca-certificates curl git openssl docker.io docker-compose-v2
  fi
  systemctl enable --now docker
  docker compose version >/dev/null 2>&1 || die 'Docker Compose plugin 安装后仍不可用。'
}

prepare_source() {
  if [[ -n "$SOURCE_DIR" ]]; then
    SOURCE_DIR="$(cd -- "$SOURCE_DIR" && pwd)"
  elif [[ -f "$SCRIPT_DIR/../../Dockerfile" && -f "$SCRIPT_DIR/../../../package.json" ]]; then
    SOURCE_DIR="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
  else
    command -v git >/dev/null 2>&1 || die '缺少 git，无法拉取 TokenLub 源码。'
    mkdir -p "$INSTALL_DIR"
    if [[ -d "$INSTALL_DIR/source/.git" ]]; then
      SOURCE_DIR="$INSTALL_DIR/source"
      git -C "$SOURCE_DIR" fetch --depth 1 origin "$REPO_REF"
      git -C "$SOURCE_DIR" checkout --force FETCH_HEAD
    elif [[ -e "$INSTALL_DIR/source" ]]; then
      die "源码目录已存在但不是 Git 仓库，请清理或指定 --source-dir：$INSTALL_DIR/source"
    else
      rm -rf "$INSTALL_DIR/source.tmp"
      git clone --depth 1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR/source.tmp"
      mv "$INSTALL_DIR/source.tmp" "$INSTALL_DIR/source"
      SOURCE_DIR="$INSTALL_DIR/source"
    fi
  fi

  [[ -f "$SOURCE_DIR/drive/Dockerfile" ]] || die "源码目录缺少 drive/Dockerfile：$SOURCE_DIR"
  [[ -f "$SOURCE_DIR/drive/docker-compose.server.yml" ]] || die "源码目录缺少 drive/docker-compose.server.yml：$SOURCE_DIR"
  [[ -f "$SOURCE_DIR/drive/docker-compose.server-ssh.yml" ]] || die "源码目录缺少 drive/docker-compose.server-ssh.yml：$SOURCE_DIR"
  [[ -f "$SOURCE_DIR/drive/ops/one-click/Caddyfile.template" ]] || die '源码目录缺少 Caddyfile 模板。'
  if [[ "$SSH_ONLY" == 1 ]]; then
    COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server-ssh.yml"
  else
    COMPOSE_FILE="$SOURCE_DIR/drive/docker-compose.server.yml"
  fi
}

generate_secret() {
  openssl rand -hex 32
}

upsert_env() {
  local key="$1"
  local value="$2"
  local file="$3"
  local temp="${file}.tmp"

  if grep -qE "^${key}=" "$file"; then
    awk -v key="$key" -v value="$value" '
      BEGIN { prefix = key "="; found = 0 }
      index($0, prefix) == 1 { print prefix value; found = 1; next }
      { print }
      END { if (!found) print prefix value }
    ' "$file" > "$temp"
    mv "$temp" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

ensure_env() {
  mkdir -p "$INSTALL_DIR"
  local env_file="$INSTALL_DIR/.env"
  touch "$env_file"
  local postgres_password
  local access_token_secret
  postgres_password="$(grep -E '^POSTGRES_PASSWORD=.+$' "$env_file" | head -n 1 | cut -d= -f2- || true)"
  access_token_secret="$(grep -E '^ACCESS_TOKEN_SECRET=.+$' "$env_file" | head -n 1 | cut -d= -f2- || true)"
  [[ -n "$postgres_password" ]] || postgres_password="$(generate_secret)"
  [[ -n "$access_token_secret" ]] || access_token_secret="$(generate_secret)"

  upsert_env POSTGRES_DB tokenlub "$env_file"
  upsert_env POSTGRES_USER tokenlub "$env_file"
  upsert_env POSTGRES_PASSWORD "$postgres_password" "$env_file"
  upsert_env ACCESS_TOKEN_SECRET "$access_token_secret" "$env_file"
  upsert_env TOKENLUB_INSTALL_DIR "$INSTALL_DIR" "$env_file"
  upsert_env TOKENLUB_SSH_ONLY "$SSH_ONLY" "$env_file"
  upsert_env TOKENLUB_PROJECT_NAME "$PROJECT_NAME" "$env_file"
  if [[ "$SSH_ONLY" == 0 ]]; then
    upsert_env TOKENLUB_DOMAIN "$DOMAIN" "$env_file"
    upsert_env ACME_EMAIL "$ACME_EMAIL" "$env_file"
    upsert_env CONSOLE_ORIGIN "https://$DOMAIN" "$env_file"
  fi
  if [[ -n "$ADMIN_EMAIL" ]]; then
    upsert_env ADMIN_EMAIL "$ADMIN_EMAIL" "$env_file"
  fi
  chmod 600 "$env_file"

  if [[ "$SSH_ONLY" == 0 ]]; then
    cp "$SOURCE_DIR/drive/ops/one-click/Caddyfile.template" "$INSTALL_DIR/Caddyfile"
    chmod 644 "$INSTALL_DIR/Caddyfile"
  fi
}

compose() {
  docker compose \
    --project-name "$PROJECT_NAME" \
    --project-directory "$SOURCE_DIR" \
    --env-file "$INSTALL_DIR/.env" \
    -f "$COMPOSE_FILE" "$@"
}

wait_for_app() {
  local attempt
  for attempt in $(seq 1 60); do
    if compose exec -T app node -e "fetch('http://127.0.0.1:3000/healthz').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  compose ps
  compose logs --tail=100 app db
  return 1
}

install_cli() {
  cat > /usr/local/bin/tokenlub-sync <<EOF
#!/usr/bin/env bash
set -Eeuo pipefail
export TOKENLUB_INSTALL_DIR="$INSTALL_DIR"
export TOKENLUB_SOURCE_DIR="$SOURCE_DIR"
export TOKENLUB_SSH_ONLY="$SSH_ONLY"
export TOKENLUB_PROJECT_NAME="$PROJECT_NAME"
exec bash "$SOURCE_DIR/drive/ops/one-click/tokenlub-sync.sh" "\$@"
EOF
  chmod 755 /usr/local/bin/tokenlub-sync
}

main() {
  parse_args "$@"
  require_root
  validate_inputs
  check_os
  install_runtime
  prepare_source
  ensure_env

  log '检查生产 Compose 配置。'
  compose config --quiet
  if [[ "$SSH_ONLY" == 1 ]]; then
    log '启动 PostgreSQL 和 TokenLub（SSH 隧道模式）。'
  else
    log '启动 PostgreSQL、TokenLub 和 Caddy。'
  fi
  compose up -d --build
  wait_for_app || die 'TokenLub 应用健康检查失败，请查看上面的容器日志。'
  if [[ "$SSH_ONLY" == 0 ]]; then
    compose exec -T caddy caddy validate --config /etc/caddy/Caddyfile >/dev/null
  fi
  install_cli

  log '安装完成。'
  if [[ "$SSH_ONLY" == 1 ]]; then
    printf '\n同步服务： http://127.0.0.1:3000（请通过 SSH 隧道访问）\n控制台：   http://127.0.0.1:3000/console\n部署目录： %s\n\n' "$INSTALL_DIR"
  else
    printf '\n同步服务： https://%s\n控制台：   https://%s/console\n部署目录： %s\n\n' \
      "$DOMAIN" "$DOMAIN" "$INSTALL_DIR"
  fi
  printf '常用命令：\n  tokenlub-sync backup\n  tokenlub-sync upgrade\n  tokenlub-sync logs\n'
}

main "$@"
