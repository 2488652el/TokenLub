# TokenLub 云端同步完整操作说明书

适用版本：TokenLub `1.0.2`  
更新时间：2026-07-14  
服务器：Ubuntu `ubuntu@119.29.146.180`  
部署目录：`/home/ubuntu/tokenlub-phase4`

本文从一台空白 Ubuntu 云服务器开始，说明如何部署 TokenLub 同步服务、安装 Windows
客户端、注册内置账号、建立 SSH 加密隧道，并完成第一台和第二台电脑的同步。

> 当前服务器已经部署完成。如果只是开始使用，可直接从“第五部分：建立 Windows SSH
> 隧道”开始。前面的章节用于重装服务器或在另一台 Ubuntu 主机重新部署。

## 一、最终架构与安全边界

```text
TokenLub Windows 客户端
  -> http://127.0.0.1:18787
  -> Windows OpenSSH 加密隧道
  -> Ubuntu 127.0.0.1:3000
  -> TokenLub Server 容器
  -> PostgreSQL 容器私有网络
```

- 不需要域名、Caddy、Nginx、OIDC、SMTP 或认证插件。
- 云服务器安全组只需开放 SSH `22/TCP`，建议来源限制为自己的公网 IP。
- 不开放公网 `3000`、`5432`、`80` 或 `443`。
- TokenLub 使用内置邮箱和密码登录；密码哈希保存在 PostgreSQL。
- Windows 客户端的 access token 和 refresh token 使用 Electron 安全存储加密。
- SSH 隧道关闭后同步会暂时失败，但本地功能和 dirty 状态不会丢失；重新建立隧道后可继续同步。

## 二、准备清单

### 2.1 云服务器

- Ubuntu 22.04 LTS 或 24.04 LTS，64 位。
- 建议至少 2 核 CPU、2 GB 内存、20 GB 磁盘。
- 登录地址：`ubuntu@119.29.146.180`。
- SSH 私钥：`D:\bestz\Downloads\test.pem`。
- 安全组入站规则：只开放 `22/TCP`，来源尽量限制为自己的公网 IP。

Docker 官方当前支持 Ubuntu 22.04 和 24.04；安装命令以
[Docker Engine on Ubuntu](https://docs.docker.com/engine/install/ubuntu/) 为准。

### 2.2 Windows 电脑

- Windows 10/11 64 位。
- TokenLub 安装包：
  `D:\开发\tokengirl\artifacts\dist\TokenLub-1.0.2-x64.exe`。
- Windows OpenSSH Client。Windows 10 1809 及更高版本可通过“可选功能”安装，参见
  [Microsoft Windows Terminal SSH](https://learn.microsoft.com/windows/terminal/tutorials/ssh)。

检查 OpenSSH：

```powershell
ssh -V
```

若提示找不到 `ssh`，请使用管理员 PowerShell 安装：

```powershell
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH.Client*'
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

## 三、从零安装 Ubuntu 云端服务

当前服务器已经安装完成；只有重装或迁移服务器时才需要执行本部分。

### 3.1 登录服务器

在 Windows PowerShell 执行：

```powershell
ssh -i "D:\bestz\Downloads\test.pem" ubuntu@119.29.146.180
```

首次连接会询问是否信任主机指纹。确认控制台显示的 IP 为
`119.29.146.180` 后输入 `yes`。

### 3.2 安装 Docker Engine 与 Compose plugin

在 Ubuntu 中执行：

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

添加 Docker 官方软件源：

```bash
sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin
```

允许当前用户执行 Docker：

```bash
sudo usermod -aG docker "$USER"
exit
```

重新 SSH 登录，然后验证：

```bash
docker version
docker compose version
docker run --rm hello-world
```

### 3.3 在 Windows 打包服务端源码

打开新的 Windows PowerShell，进入项目目录：

```powershell
Set-Location "D:\开发\tokengirl"
```

创建仅包含服务端构建所需文件的压缩包：

```powershell
$archive = Join-Path $env:TEMP "tokenlub-server-1.0.2.tar.gz"
tar -czf $archive Dockerfile docker-compose.yml .dockerignore .env.example `
  package.json package-lock.json tsconfig.node.json src ops
```

上传服务器：

```powershell
scp -i "D:\bestz\Downloads\test.pem" $archive `
  ubuntu@119.29.146.180:/home/ubuntu/
```

### 3.4 解压项目

重新进入 Ubuntu SSH 会话：

```bash
mkdir -p /home/ubuntu/tokenlub-phase4
tar -xzf /home/ubuntu/tokenlub-server-1.0.2.tar.gz \
  -C /home/ubuntu/tokenlub-phase4
rm /home/ubuntu/tokenlub-server-1.0.2.tar.gz
cd /home/ubuntu/tokenlub-phase4
```

确认关键文件存在：

```bash
ls -l Dockerfile docker-compose.yml package.json .env.example
```

### 3.5 创建生产环境变量

以下命令生成随机数据库密码和 access token 签名密钥，不会把值打印到终端：

```bash
cd /home/ubuntu/tokenlub-phase4
umask 077
cp .env.example .env

POSTGRES_PASSWORD_VALUE="$(openssl rand -hex 32)"
ACCESS_TOKEN_SECRET_VALUE="$(openssl rand -hex 32)"

sed -i "s|replace-with-a-long-random-value|$POSTGRES_PASSWORD_VALUE|" .env
sed -i "s|replace-with-at-least-32-random-characters|$ACCESS_TOKEN_SECRET_VALUE|" .env

unset POSTGRES_PASSWORD_VALUE ACCESS_TOKEN_SECRET_VALUE
chmod 600 .env
```

如需让某个内置账号读取只读运维指标，可编辑 `.env` 并设置：

```text
ADMIN_EMAIL=你的邮箱
```

`ADMIN_EMAIL` 不是额外账号。它必须与后续注册的内置账号邮箱一致。不要在聊天、日志或
截图中公开 `.env` 内容。

### 3.6 构建并启动服务

```bash
cd /home/ubuntu/tokenlub-phase4
docker compose config --quiet
docker compose up -d --build --wait --wait-timeout 60
```

查看状态：

```bash
docker compose ps
```

预期结果：

- `app` 为 `running (healthy)`。
- `db` 为 `running (healthy)`。
- app 端口显示 `127.0.0.1:3000->3000/tcp`。
- PostgreSQL 不显示宿主机映射端口。

服务器本机健康检查：

```bash
curl --fail http://127.0.0.1:3000/healthz
```

预期响应：

```json
{ "ok": true, "phase": 1 }
```

### 3.7 检查云防火墙

在云厂商安全组中确认：

| 方向 | 协议/端口  | 来源          | 操作                     |
| ---- | ---------- | ------------- | ------------------------ |
| 入站 | TCP 22     | 自己的公网 IP | 允许                     |
| 入站 | TCP 3000   | 任意          | 不允许                   |
| 入站 | TCP 5432   | 任意          | 不允许                   |
| 入站 | TCP 80/443 | 任意          | 当前方案不需要           |
| 出站 | TCP 443    | 任意          | 允许，用于拉取镜像和依赖 |

## 四、安装 Windows 客户端

### 4.1 校验安装包

安装包路径：

```text
D:\开发\tokengirl\artifacts\dist\TokenLub-1.0.2-x64.exe
```

校验 SHA-256：

```powershell
Get-FileHash -Algorithm SHA256 `
  "D:\开发\tokengirl\artifacts\dist\TokenLub-1.0.2-x64.exe"
```

当前 `1.0.2` 安装包的 SHA-256：

```text
19A5C46F03E22FC99F22FE75F7CA3E99D2E50F27540808D154E08582E61EC4E8
```

安装包尚未代码签名，Windows SmartScreen 可能提示未知发布者。只有哈希一致且文件来自上述
项目目录时，才点击“更多信息 → 仍要运行”。

### 4.2 安装 TokenLub

1. 双击 `TokenLub-1.0.2-x64.exe`。
2. 选择安装目录。
3. 保留“创建桌面快捷方式”和“创建开始菜单快捷方式”。
4. 完成安装并启动 TokenLub。
5. 初次启动后先确认“用量概览”“API Keys”“设置”等页面可以正常打开。

## 五、建立 Windows SSH 隧道

SSH 窗口必须保持运行；它是 Windows 客户端与云服务器之间的加密通道。

### 5.1 收紧私钥权限

在普通 PowerShell 中执行一次：

```powershell
$key = "D:\bestz\Downloads\test.pem"
icacls $key /inheritance:r
icacls $key /grant:r "$($env:USERNAME):(R)"
```

### 5.2 启动隧道

```powershell
ssh -i "D:\bestz\Downloads\test.pem" `
  -o ExitOnForwardFailure=yes `
  -o ServerAliveInterval=30 `
  -N -L 18787:127.0.0.1:3000 `
  ubuntu@119.29.146.180
```

该命令成功后通常不会输出内容，也不会返回 PowerShell 提示符。不要关闭这个窗口。

如果 `18787` 已被占用，可改为 `18788`，但后续所有服务地址也必须改成
`http://127.0.0.1:18788`。

### 5.3 验证隧道

打开第二个 PowerShell：

```powershell
Test-NetConnection 127.0.0.1 -Port 18787
Invoke-RestMethod http://127.0.0.1:18787/healthz
```

预期 `TcpTestSucceeded` 为 `True`，健康响应中的 `ok` 为 `True`。

## 六、注册内置账号并取得设备 ID

### 6.1 打开 Web 控制台

```powershell
Start-Process "http://127.0.0.1:18787/console"
```

页面标题应为“TokenLub 控制台”。

### 6.2 注册第一台设备

在“登录或注册”区域填写：

| 字段     | 填写内容                 |
| -------- | ------------------------ |
| 服务地址 | `http://127.0.0.1:18787` |
| 邮箱     | 自己的登录邮箱           |
| 密码     | 自己设置的强密码         |
| 设备 ID  | 首次注册时留空           |
| 设备名称 | 例如 `Windows 主机 A`    |

点击“注册并登录”。

注册成功后页面会显示设备列表。复制 `Windows 主机 A` 下方的完整设备 ID。设备 ID 是长
字符串，不是设备名称；后续桌面客户端登录必须使用它。

> 同一邮箱只能注册一次。以后应点击“登录”，不要再次点击“注册并登录”。

## 七、第一台 Windows 电脑开始同步

### 7.1 打开同步设置

1. 启动 TokenLub。
2. 打开左侧“设置”。
3. 找到“云端同步”卡片。

### 7.2 填写登录信息

| 字段         | 填写内容                 |
| ------------ | ------------------------ |
| 服务地址     | `http://127.0.0.1:18787` |
| 邮箱         | 第六部分注册的邮箱       |
| 密码         | 注册时设置的密码         |
| 设备 ID      | Web 控制台复制的设备 ID  |
| 初次同步模式 | 通常选择“合并本机与云端” |

### 7.3 理解三种初次同步模式

| 模式           | 行为                                                  | 适用场景                                             |
| -------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| 合并本机与云端 | 上传本机实体并拉取云端实体；价格冲突保留待处理记录    | 推荐默认选择；两边都有数据时使用                     |
| 仅上传本机数据 | 上传本机数据，不拉取云端变化                          | 临时把一台权威电脑的数据种到空云端；不是长期双向模式 |
| 仅恢复云端数据 | 先备份本机数据库，再以云端快照覆盖本机同步投影 | 新电脑、本机数据不需要保留时使用                     |

“仅恢复”会显示覆盖确认框。确认前检查卡片中的本机实体数、预计上传数、风险提示和备份
目录。

### 7.4 登录并同步

1. 点击“登录同步服务”。
2. 登录成功后密码输入框会自动清空。
3. 点击“立即同步”。
4. 等待状态从 `syncing` 变为 `idle`。

正常状态应显示：

- `状态：idle`。
- 模式与选择一致。
- “快照版本”大于或等于 0。
- 有数据时显示“服务端确认”时间。
- 设备列表中能看到当前设备，且没有“已撤销”标记。

### 7.5 在 Web 控制台复核

刷新 `http://127.0.0.1:18787/console`，使用同一邮箱、密码和设备 ID 登录。

检查：

- “同步实体”总数不再为 0（本机原本有同步数据时）。
- 设置、价格数量符合预期。
- 设备的“在线”和“同步”时间已经更新。
- “冲突”区域为空，或只包含需要人工选择的价格冲突。

## 八、第二台 Windows 电脑同步

每台电脑应使用不同设备 ID。第二台电脑也需要建立自己的 SSH 隧道。

### 8.1 在第二台电脑安装并建立隧道

重复第四、第五部分。第二台电脑本地也可使用端口 `18787`，因为两台电脑的本地端口互不
冲突。

### 8.2 创建第二个设备 ID

Web 控制台当前只在首次注册时创建第一个设备。第二台电脑可在 PowerShell 中用现有设备
登录并创建新设备；令牌只保存在当前 PowerShell 内存中，不会打印出来：

```powershell
$baseUrl = "http://127.0.0.1:18787"
$email = Read-Host "登录邮箱"
$existingDeviceId = Read-Host "第一台电脑的设备 ID"
$credential = Get-Credential -UserName $email -Message "输入 TokenLub 密码"
$password = $credential.GetNetworkCredential().Password

$session = Invoke-RestMethod -Method Post `
  -Uri "$baseUrl/v1/auth/login" `
  -ContentType "application/json" `
  -Body (@{
    email = $email
    password = $password
    deviceId = $existingDeviceId
  } | ConvertTo-Json)

$newDevice = Invoke-RestMethod -Method Post `
  -Uri "$baseUrl/v1/devices" `
  -Headers @{ Authorization = "Bearer $($session.accessToken)" } `
  -ContentType "application/json" `
  -Body (@{
    name = "Windows 主机 B"
    platform = "windows"
    appVersion = "1.0.2"
  } | ConvertTo-Json)

$newDevice.id
Remove-Variable password, session, credential
```

复制最后输出的新设备 ID。

### 8.3 第二台电脑恢复或合并

在第二台电脑的 TokenLub“设置 → 云端同步”填写：

- 服务地址：`http://127.0.0.1:18787`。
- 同一邮箱和密码。
- 新创建的第二个设备 ID。
- 全新电脑通常选择“仅恢复云端数据”。
- 第二台电脑已有需要保留的数据时选择“合并本机与云端”。

点击“登录同步服务”，确认风险提示后点击“立即同步”。

## 九、验证两台电脑确实收敛

建议使用无敏感信息的设置做验证：

1. 在电脑 A 将“余额自动刷新间隔”改为 `15 分钟`。
2. 在电脑 A 点击“立即同步”，等待状态为 `idle`。
3. 在电脑 B 点击“立即同步”。
4. 检查电脑 B 的“余额自动刷新间隔”是否变为 `15 分钟`。
5. 再由电脑 B 改为 `30 分钟`，重复同步并检查电脑 A。
6. 在 Web 控制台确认两台设备的最近同步时间都已更新。

同步调度还会在以下时机自动触发：

- 应用启动后。
- 本地同步数据改变约 2 秒后。
- 网络恢复或系统唤醒后。
- 收到服务端新变更通知后。
- 每 30 分钟兜底同步一次。

## 十、当前同步和不同步的数据

### 10.1 当前同步

- 应用设置。
- 模型定价。
- 余额快照，但不包含供应商原始返回。

### 10.2 当前不上传

- API Key 和额外凭据。
- `encrypted_key`、`extra_credentials`。
- 原始请求和模型响应。
- CLI 原始 JSONL 日志。
- `balance_snapshots.raw_json` 和 `api_key_id`。
- 完整本地 SQLite 数据库文件。

因此云同步不能代替 API Key 备份，也不能把另一台电脑自动配置成拥有相同供应商密钥。

## 十一、日常使用

### 11.1 每次开机

1. 先运行第五部分的 SSH 隧道命令。
2. 验证 `http://127.0.0.1:18787/healthz`。
3. 再启动 TokenLub。
4. 在“设置 → 云端同步”确认状态不是 `needs_login` 或 `error`。

### 11.2 关闭隧道

在运行 SSH 的窗口按 `Ctrl+C`。隧道关闭后本地修改会保留 dirty 标记，重新连接后继续 exchange。

### 11.3 后台运行隧道

可使用隐藏窗口启动：

```powershell
$ssh = Start-Process ssh -WindowStyle Hidden -PassThru -ArgumentList @(
  '-i', 'D:\bestz\Downloads\test.pem',
  '-o', 'ExitOnForwardFailure=yes',
  '-o', 'ServerAliveInterval=30',
  '-N', '-L', '18787:127.0.0.1:3000',
  'ubuntu@119.29.146.180'
)
$ssh.Id
```

记住输出的 PID。需要关闭时：

```powershell
Stop-Process -Id <PID>
```

## 十二、设备、密码和云端数据管理

### 12.1 撤销丢失的设备

在桌面端“设置 → 云端同步”的设备列表中找到目标设备，点击“撤销”。撤销后该设备的旧
access token 和 refresh token 会立即失效。

不要撤销正在使用的当前设备，否则当前客户端会进入重新登录状态。

### 12.2 修改密码

1. 打开 Web 控制台。
2. 在“账户安全”填写当前密码和新密码。
3. 提交修改。
4. 所有旧会话会失效。
5. 每台电脑重新使用邮箱、新密码和对应设备 ID登录。

### 12.3 导出或删除云端数据

Web 控制台提供“创建导出任务”和“删除云端数据”。删除操作会保留账号和设备，但删除云端
同步实体；执行前必须先做好数据库备份。

## 十三、备份、恢复和更新

### 13.1 创建 PostgreSQL 备份

在 Ubuntu 执行：

```bash
cd /home/ubuntu/tokenlub-phase4
umask 077
sudo install -d -m 700 -o "$USER" -g "$USER" /var/backups/tokenlub
docker compose exec -T db sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner \
   -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  > /var/backups/tokenlub/tokenlub-$(date -u +%Y%m%dT%H%M%SZ).dump
chmod 600 /var/backups/tokenlub/*.dump
```

检查最新备份：

```bash
ls -lh /var/backups/tokenlub
```

### 13.2 隔离恢复演练

```bash
cd /home/ubuntu/tokenlub-phase4
DUMP_FILE=/var/backups/tokenlub/tokenlub-<时间戳>.dump \
  ./ops/restore-postgres-rehearsal.sh
```

该脚本使用独立 Compose project 和 volume，不覆盖正在运行的数据库。

### 13.3 运行隐私审计

完成真实同步后在 Ubuntu 执行：

```bash
cd /home/ubuntu/tokenlub-phase4
sh ops/privacy-audit.sh
```

预期输出为 `privacy audit passed`。脚本只输出计数或通用错误，不打印匹配到的 payload 和日志。

### 13.4 更新服务端

1. 先创建数据库备份。
2. 在 Windows 重新执行 3.3，上传新版源码压缩包。
3. 在 Ubuntu 解压覆盖 `/home/ubuntu/tokenlub-phase4`，但保留原 `.env`。
4. 执行：

```bash
cd /home/ubuntu/tokenlub-phase4
docker compose config --quiet
docker compose build app
docker compose up -d --wait --wait-timeout 60
curl --fail http://127.0.0.1:3000/healthz
```

5. 建立隧道并完成一次双设备同步验证。

## 十四、故障排查

### 14.1 客户端提示网络或认证失败

按顺序执行：

```powershell
Test-NetConnection 119.29.146.180 -Port 22
Test-NetConnection 127.0.0.1 -Port 18787
Invoke-RestMethod http://127.0.0.1:18787/healthz
```

- 服务器 22 不通：检查云安全组、服务器状态和本机网络。
- 本机 18787 不通：SSH 隧道没有运行或已断开。
- 健康接口不通：登录 Ubuntu 检查容器。
- 健康接口正常但认证失败：检查邮箱、密码、设备 ID，以及设备是否已撤销。

### 14.2 检查服务器容器

```bash
cd /home/ubuntu/tokenlub-phase4
docker compose ps
docker compose logs --tail=200 app
docker compose logs --tail=100 db
```

不要把 `.env`、授权头、令牌或完整数据库内容粘贴到公开聊天中。

### 14.3 数据库健康检查

```bash
docker compose exec -T db pg_isready -U tokenlub -d tokenlub
```

### 14.4 状态为 `needs_login`

常见原因：密码已修改、会话被撤销、当前设备被撤销或 refresh token 已失效。重新在“设置 →
云端同步”填写账号和该电脑的有效设备 ID，点击“登录同步服务”。

### 14.5 游标过期

服务端只保留当前用户快照，不再维护变更日志或 cursor。客户端 revision 过期时会先接收当前
云端快照；有本地 dirty 修改时在最新 revision 上合并重试。不要手工修改 SQLite revision。

### 14.6 本地端口被占用

```powershell
Get-NetTCPConnection -LocalPort 18787 -ErrorAction SilentlyContinue
```

选择其他空闲端口，例如 `18788`，重新建立隧道，并把 Web 控制台和客户端服务地址统一改为
`http://127.0.0.1:18788`。

## 十五、停止与卸载

只停止服务但保留数据库：

```bash
cd /home/ubuntu/tokenlub-phase4
docker compose stop
```

重新启动：

```bash
docker compose up -d --wait --wait-timeout 60
```

停止并删除容器但保留 PostgreSQL volume：

```bash
docker compose down
```

> `docker compose down -v` 会永久删除 PostgreSQL 数据卷。只有完成备份并明确要清空所有云端
> 账号和同步数据时才能执行。

## 十六、最终验收清单

- [ ] 云安全组只开放必要的 SSH 22 端口。
- [ ] `docker compose ps` 中 app/db 均为 healthy。
- [ ] app 只映射 `127.0.0.1:3000`，数据库没有宿主机端口。
- [ ] Windows `ssh -V` 正常，SSH 隧道可保持运行。
- [ ] `http://127.0.0.1:18787/healthz` 返回 `ok: true`。
- [ ] Web 控制台完成内置账号注册并取得设备 ID。
- [ ] Windows 客户端显示 `状态：idle` 和服务端确认时间。
- [ ] 两台电脑使用不同设备 ID。
- [ ] 双向修改无敏感设置后可收敛。
- [ ] PostgreSQL dump 已创建并完成至少一次隔离恢复演练。
- [ ] `.env` 和 SSH 私钥未进入仓库、截图或聊天记录。
