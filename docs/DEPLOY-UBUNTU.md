# TokenLub Ubuntu 自托管部署

目标形态：一台 Ubuntu 服务器、内置账号密码、无域名、无外置认证。应用仅绑定服务器
`127.0.0.1:3000`，Windows 客户端通过 SSH 隧道访问，PostgreSQL 仅在 Compose 网络内可见。

## 首次部署

1. 安装 Docker Engine 与 Compose plugin。
2. 复制 `.env.example` 为 `.env`，用 `openssl rand -hex 32` 分别生成
   `POSTGRES_PASSWORD` 与 `ACCESS_TOKEN_SECRET`；不要提交或打印 `.env`。
3. 可选设置 `ADMIN_EMAIL` 为已注册的内置账号；只有该账号能读取运维指标和脱敏审计。
4. 启动并检查健康状态：

```sh
docker compose up -d --build
curl --fail http://127.0.0.1:3000/healthz
```

应用会在监听端口前自动执行数据库迁移。

## Windows 连接

保持以下命令运行；`test.pem` 路径按本机实际位置替换：

```powershell
ssh -i D:\bestz\Downloads\test.pem -N -L 8787:127.0.0.1:3000 ubuntu@119.29.146.180
```

随后访问 `http://127.0.0.1:8787/console`，客户端同步地址填写
`http://127.0.0.1:8787`。公网链路由 SSH 加密，服务器无需开放 3000、80 或 443 端口。

## 备份与恢复

```sh
umask 077
mkdir -p /var/backups/tokenlub
docker compose exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner \
   -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > /var/backups/tokenlub/tokenlub-$(date -u +%Y%m%dT%H%M%SZ).dump
```

已有可达的 `DATABASE_URL` 与 `pg_dump` 时也可运行 `ops/backup-postgres.sh`。脚本在可用空间
低于 `MIN_FREE_MB`（默认 1024）时安全停止。

隔离恢复演练：

```sh
DUMP_FILE=/var/backups/tokenlub/tokenlub-<timestamp>.dump \
 ./ops/restore-postgres-rehearsal.sh
```

脚本使用独立 Compose project 与 volume，完成后自动清理；仅排障时设置 `KEEP_RESTORE_DB=1`。

## 隐私与回滚

```sh
sh ops/privacy-audit.sh
```

升级前保留旧镜像和数据库 dump。先在隔离 project 中恢复并验证 `/healthz` 与双设备同步，
再切换生产镜像；除非迁移明确向后兼容，不要让旧应用直接连接新 schema。
