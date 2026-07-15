# Cloud Sync V2 验收记录

更新时间：2026-07-15  
协议版本：`2`  
客户端 SQLite schema：`v16`

## 当前结论

云同步已经收敛为“每个用户一个快照、一个 revision、一个 exchange 接口”。运行时不再包含
push、pull、ack、cursor、bootstrap、outbox、SSE 或价格冲突队列。

唯一数据写入口：

```text
POST /v1/sync/exchange
```

服务端 PostgreSQL 表 `user_sync_snapshots` 每个用户只保存一行：`revision`、`snapshot`、
`updated_at`。客户端 SQLite 表 `sync_v2_state` 保存已应用 revision、最近成功时间、本地
`dirty` 状态和一份最近成功快照基线。

## 同步范围

允许进入云端快照的数据：

- 设置：`refresh_interval_min`、`session_auto_parse_enabled`。
- 模型价格：按 `providerId + billingScope + model + currency` 作为自然键；旧快照缺少 `billingScope` 时兼容为 `default`，并同步目录有效状态。
- 价格目录历史和待确认预览只保留在本机，不上传到云端；云端只接收已应用的当前价格快照。
- 余额快照：使用稳定 UUID 去重；不包含本机 API Key ID 和原始响应。

明确不上传：API Key、token、密码、认证信息、加密凭证、原始 Provider 响应、本地日志和
其他未列入白名单的设置。服务端同时执行敏感键和白名单校验。

## 收敛规则

- revision 相同时，`merge` 才允许提交新快照。
- revision 过期时，服务端只返回当前云端快照，不直接写入，避免两台设备用旧完整快照
  相互覆盖并造成版本振荡。
- 干净客户端直接应用云端快照。
- 有本地未同步修改的客户端以最近成功快照做三方比较，只把真正的本地变化合并到最新
  云端快照后重试；连续竞争失败时
  保留 dirty 状态并报告错误，不静默丢数据。
- `upload` 和 `restore` 只用于首次同步；成功一次后会话自动切换为日常 `merge`。
- 同步应用在单个 SQLite transaction 内完成，revision 与数据同时提交。

## 自动同步

- 应用启动时恢复加密会话。
- 本地可同步设置、价格或余额发生变化后，2 秒防抖触发。
- 30 分钟定时同步作为兜底。
- 网络失败保留本地 dirty 状态；恢复后可手动或自动重试。
- 同一进程内由 single-flight scheduler 合并并发触发。

## 安全与账户能力

- access/refresh session、设备注册、设备重命名和设备撤销保留。
- 当前设备被撤销时，本地加密同步会话立即清除。
- 请求体限制为 2 MiB；同步接口保留限流、认证、设备归属和撤销校验。
- 日志只记录脱敏事件，不记录快照 payload 或凭证。
- 用户导出返回 V2 revision 与快照；云端删除同时清理 V2 快照和升级前可能残留的旧同步数据。

## 兼容与迁移

- SQLite v6-v11 和 PostgreSQL 001/002/007 迁移文件仍保留，用于旧数据库顺序升级。
- 旧运行时代码和 HTTP 路由已删除；旧 `/v1/sync/push|pull|ack|bootstrap|events|conflicts`
  返回 404。
- SQLite v12 创建 V2 revision 状态，v13 增加 dirty 标记，v14 增加最近成功快照基线；旧库
  首次进入 V2 且已有可同步数据时会标为 dirty，避免首次合并误丢本机数据。
- PostgreSQL 008 创建用户快照表，009 为 JSON object 添加数据库约束。

## 自动化覆盖

- 服务端快照规范化、敏感字段拒绝、CAS 重试和过期 revision 拒写。
- 两设备 HTTP exchange 收敛、交错 revision 不振荡。
- 客户端 dirty rebase、single-flight、防抖和首次模式自动回落。
- SQLite 快照生成/事务应用、敏感字段隔离和 v13 迁移。
- PostgreSQL 快照读取、revision CAS、导出、删除和迁移契约。
- 认证刷新、限流、请求体上限、设备撤销和旧路由 404。

验证命令：

```powershell
npm test
npm run typecheck
npm run lint
npm run format:check
npm run build
```

配置 `DATABASE_URL` 后可额外运行真实 PostgreSQL 集成测试；Electron 流程使用：

```powershell
npm run test:e2e -- tests/e2e/electron-startup.spec.ts --project=electron --workers=1
```

## 已知边界

- V2 是受控数据集同步，不是通用数据库复制；新增字段必须先进入共享白名单和快照校验。
- 同一自然键在两台设备同时修改时采用“已明确发生本地修改的设备，在最新 revision 上重试”
  的策略，不提供人工冲突中心。
- 历史同步表目前只为旧库升级和隐私删除保留；待支持窗口结束后可另做清理迁移。
