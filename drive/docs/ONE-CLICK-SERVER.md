# TokenLub 一键安装服务器同步（第一期）

第一期目标是把一台干净的 Ubuntu 22.04/24.04 服务器部署成可用的 TokenLub
同步服务：PostgreSQL 只在 Compose 网络内可见，TokenLub 由 Caddy 提供 HTTPS
入口，安装脚本自动生成密钥、启动服务并执行健康检查。

## 前置条件

- Ubuntu 22.04 或 24.04
- 一个已经解析到服务器的域名，例如 `sync.example.com`
- 80 和 443 端口可被访问
- 至少 2 GB 内存、10 GB 可用磁盘
- 使用 root 或具备 sudo 权限的账号

## 安装

在发布版本中，安装脚本会从固定版本的 GitHub 仓库获取源码。当前仓库的手工
验收命令如下：

```sh
sudo bash drive/ops/one-click/install.sh \
  --source-dir "$PWD" \
  --domain sync.example.com \
  --email admin@example.com
```

如果服务器暂时没有域名，使用 SSH 隧道模式。该模式不会启动 Caddy，也不会开放
80/443，只绑定 `127.0.0.1:3000`：

```sh
sudo bash drive/ops/one-click/install.sh \
  --source-dir "$PWD" \
  --ssh-only
```

从远程脚本安装时，可以指定仓库和版本：

```sh
sudo bash install.sh \
  --repo-url https://github.com/2488652el/MoonMeter.git \
  --ref v1.0.5 \
  --domain sync.example.com \
  --email admin@example.com
```

安装脚本会：

1. 检查 Ubuntu 版本、Docker、Compose、端口和参数。
2. 必要时安装 Docker Engine、Compose plugin、Git 和 OpenSSL。
3. 创建 `/opt/tokenlub` 部署目录并生成 `.env`。
4. 自动生成 `POSTGRES_PASSWORD` 和 `ACCESS_TOKEN_SECRET`。
5. 启动 PostgreSQL、TokenLub App 和 Caddy。
6. 检查 App 的 `/healthz` 和 Caddy 配置。
7. 安装 `tokenlub-sync` 运维命令。

成功后访问：

```text
https://sync.example.com/console
```

## 常用运维命令

```sh
sudo tokenlub-sync health
sudo tokenlub-sync logs
sudo tokenlub-sync backup
sudo tokenlub-sync upgrade
sudo tokenlub-sync uninstall
sh drive/ops/privacy-audit.sh
```

普通卸载只停止容器并保留数据。确认要删除数据库卷时才使用：

```sh
sudo tokenlub-sync uninstall --purge --yes
```

压缩包部署（没有 `.git`）时，升级时显式传入新的部署包：

```sh
sudo tokenlub-sync upgrade --archive /path/to/tokenlub-server-<version>.tgz
```

## 数据和安全边界

- PostgreSQL 没有宿主机端口映射，只能由 App 容器访问。
- Caddy 监听 80/443，并自动申请和续期 HTTPS 证书。
- SSH 隧道模式不启动 Caddy，只允许通过 `127.0.0.1:3000` 访问。
- `.env` 权限为 `600`，密钥不会写入安装日志。
- 数据库卷和 Caddy 证书卷由 Docker 持久化。
- 备份默认写入 `/opt/tokenlub/backups`，保留最近 14 份。
- 升级前自动执行一次 PostgreSQL dump；新版本健康检查失败时恢复旧代码并重新启动。

## 第一阶段验收

在干净 Ubuntu 虚拟机上执行安装命令，必须满足：

- `docker compose ps` 中 `db`、`app`、`caddy` 均为运行状态。
- `tokenlub-sync health` 成功返回 `/healthz`。
- `https://<域名>/console` 可以打开控制台。
- Windows 客户端可以使用 `https://<域名>` 完成注册、登录和双设备同步。
- `tokenlub-sync backup` 能生成非空 `.dump` 文件。
- 重启服务器后容器和数据自动恢复。
- `tokenlub-sync uninstall` 不删除数据；`--purge` 才删除数据卷。
