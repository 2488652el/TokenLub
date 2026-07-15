# TokenLub Cloud Sync V2 产品计划

## 1. 目标

云同步只解决一件事：让同一账户下的 TokenLub 设备安全共享少量、明确允许的数据。

设计约束：

- 一个用户一份规范快照。
- 一个单调递增 revision。
- 一个读写接口 `POST /v1/sync/exchange`。
- 不把本地 SQLite 复制成分布式数据库。
- 正确性不依赖实时连接、变更日志、人工冲突中心或后台清理任务。

## 2. 非目标

- 不同步 API Key、token、密码、认证信息、原始 Provider 响应或本地日志。
- 不提供任意 `app_settings` 同步；新增设置必须显式进入白名单。
- 不提供操作级历史、跨设备审计回放或逐字段 CRDT。
- 不提供 push/pull/ack/cursor/bootstrap/outbox/SSE/WebSocket 协议。
- 不让用户处理价格冲突队列。

## 3. 数据模型

云端 PostgreSQL：

```sql
CREATE TABLE user_sync_snapshots (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL CHECK (revision > 0),
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
```

客户端 SQLite：

```text
sync_v2_state
  revision          最后成功应用的云端版本
  last_success_at   最近成功同步时间
  dirty             是否存在尚未确认的本地可同步修改
  base_snapshot     最近成功应用的快照，用于三方比较
```

快照只包含：

```text
settings  白名单设置
pricing   按 providerId + model + currency 去重
balances  按稳定 UUID 去重的脱敏余额
```

## 4. Exchange 契约

请求：

```json
{
  "protocolVersion": 2,
  "deviceId": "device-id",
  "baseRevision": 7,
  "strategy": "merge",
  "snapshot": {
    "settings": {},
    "pricing": [],
    "balances": []
  }
}
```

响应：

```json
{
  "revision": 8,
  "serverTime": "2026-07-14T00:00:00.000Z",
  "snapshot": {},
  "changed": true,
  "accepted": true
}
```

`accepted=false` 表示请求快照未写入，客户端应按返回的规范快照处理。

## 5. 收敛与冲突策略

### 日常 merge

1. base revision 与云端一致：服务端规范化并 CAS 写入。
2. base revision 过期：服务端只返回当前快照，不写入。
3. 本地 `dirty=0`：客户端应用云端快照。
4. 本地 `dirty=1`：客户端用 `base_snapshot` 比较本地快照，只把真实本地修改合并到最新
   云端快照，在新 revision 上重试。
5. 连续竞争失败：保留 dirty 并报错，等待下一次重试。

这样可以阻止两台设备拿旧完整快照来回覆盖。对同一自然键的真正并发修改，最近完成 rebase
的本地修改获胜；系统不创建长期冲突记录。

### 首次同步

- `upload`：明确用本机快照覆盖云端。
- `restore`：明确用云端快照覆盖本机可同步投影。
- `merge`：合并本机和云端受控数据。

首次 exchange 成功后，会话必须自动改为 `merge`，不能永久停留在 upload/restore。

## 6. 自动同步

- 启动恢复加密会话。
- 可同步设置、价格和余额修改后 2 秒防抖。
- 30 分钟定时兜底。
- 手动触发。
- 同一进程 single-flight，重复触发合并。
- 网络失败不清 dirty；恢复后重试。

不引入 SSE 或 WebSocket。若未来需要更快刷新，只能添加“提示客户端执行 exchange”的可选
通知，不能成为正确性前提。

## 7. 安全要求

- 所有同步请求必须验证 access session、设备归属和撤销状态。
- 服务端从认证信息确定 userId，忽略业务 payload 中任何身份字段。
- 请求上限 2 MiB，保留速率限制。
- 设置同时执行固定白名单和敏感关键词拒绝。
- 余额必须移除本地 API Key ID 与 raw payload。
- 日志不得包含 snapshot、token、密码或凭证。
- 当前设备被撤销时客户端清除本地加密会话。

## 8. 兼容策略

- 保留旧 SQLite/PostgreSQL 迁移文件，确保历史数据库能顺序升级。
- 旧 HTTP 路由和运行时代码不保留双轨；升级后旧同步调用返回 404。
- 云端数据删除同时清理 V2 快照和旧表中可能残留的用户数据。
- 支持窗口结束后，可单独发布迁移删除旧运行时表；不要在协议切换中同时做破坏性清表。

## 9. 验收门槛

- 两设备通过 exchange 收敛。
- 交错 revision 不发生值振荡或无意义 revision 增长。
- dirty 客户端可 rebase，干净客户端不会把旧值写回。
- upload/restore 只执行一次。
- 网络失败、服务重启、客户端重启和 SQLite 锁失败后可恢复。
- 敏感设置、超大 payload、撤销设备和跨用户访问均被拒绝。
- PostgreSQL CAS、导出、删除和迁移有测试。
- `typecheck`、全量测试、lint、format check、build 全部通过。

## 10. 后续扩展判断

新增同步数据前先回答：

1. 是否能安全地形成脱敏、稳定、有限大小的快照？
2. 是否有明确自然键？
3. 是否需要删除语义，还是完整快照覆盖即可？
4. 同键并发是否能接受当前 rebase 后本地修改获胜？
5. 是否会让快照逼近 2 MiB 上限？

任一答案不明确，就不要直接加入 V2 快照；应先设计独立、窄范围的产品能力。
