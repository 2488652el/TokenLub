# TokenLub 对抗式审查修复设计

**日期：** 2026-07-10  
**范围：** 凭证 origin 绑定、vendor 用量唯一键、Claude 增量日志、Admin Provider 分页、价格 CRUD

## 目标

修复审查确认的高风险数据与凭证问题，同时保持 Electron 三进程边界、现有 Provider 插件接口和旧数据库可升级。每个修复都必须有先失败后通过的回归测试，并保持小而可审查的提交。

## 总体方案

采用分阶段、兼容优先的方案：先修复五个 P0 域，再处理刷新并发、超时、单位展示、真实 Electron E2E、Electron 升级和 Windows 签名。首阶段不重写 IPC 或 Provider 架构，只增加边界校验、迁移和缺失行为。

## 设计决策

### 1. 凭证 origin 绑定

- 官方 Provider 的 Base URL 必须解析为官方 HTTPS origin；不接受 `file:`, `ftp:`, UNC、loopback、链路本地或私网地址。
- `newapi-generic` 是显式自建代理能力，可使用 HTTP(S)、localhost 和内网地址；界面应明确展示目标 origin。
- 更新已有 Key 时，如果 origin 发生变化且没有重新提交对应凭证，Main 拒绝更新。对 Anthropic/OpenAI Admin 的 `adminKey`、LongCat Cookie 等额外凭证同样适用。
- 约束必须在 Main 侧执行；Renderer 的 `type=url` 只是用户体验校验，不能作为安全边界。
- `keys:test` 和后台刷新继续只在 Main 解密凭证，不能把明文返回 Renderer。

建议接口：新增共享 `validateProviderEndpoint(providerId, url)` 和 Main 侧 `originChanged(existing, next)` 辅助函数；更新 schema 只负责结构与长度，Provider 白名单和 origin 迁移策略放在 Main。

### 2. vendor 用量唯一键与迁移

- 新 schema migration 在现有 v2 后增加 v3；迁移必须幂等并保留已有数据。
- vendor-api 记录的唯一性至少包含 `api_key_id`, `provider_id`, `model`, `period_start`。
- OpenAI/Anthropic Admin 额外保存上游稳定维度（如 project/user 或上游 record ID）；若上游没有稳定 ID，使用明确的维度组合而不是静默覆盖。
- `insertUsage` 使用显式 UPSERT/冲突策略：同一上游桶重复刷新更新累计值；不同 Key 或维度不得互相吞掉。
- session-log 继续按 `message_id` 去重；`message_id` 为空时必须由 parser 生成稳定 fallback。

### 3. Claude 增量日志

- Parser 只解析输入中最后一个完整换行前的内容。
- `nextOffset` 只推进到该完整换行对应的字节位置；未完成尾行留给下一次同步。
- 当文件大小小于保存 offset，或检测到轮转/替换，offset 从 0 重新开始。
- UTF-8 字节 offset 继续使用 Buffer，不改为 UTF-16 字符偏移。

### 4. Admin Provider 分页

- OpenAI Admin 与 Anthropic Admin 对 `has_more/next_page` 使用 cursor 循环。
- 每次请求复用现有 HTTP client 和 timeout；最大页数、最大累计条目数必须有限，防止异常上游无限分页。
- 页面顺序不影响最终聚合；重复页面通过上游 ID/业务键去重。
- 单页失败时整次刷新报告失败，不写入不完整的成功结果。

### 5. 价格 CRUD

- 编辑已有条目按 `id` 更新；Provider、Model、Currency 作为唯一键的修改要么禁止，要么显式执行“复制为新 user override”，不能隐式留下旧行。
- 任何用户在 UI 中提交的价格都保存为 `source='user'`；官方 catalog 只能由 catalog sync 写入。
- `pricing.restore` 语义改为从 catalog 恢复：删除对应 user override 后恢复匹配 catalog 行；若无 catalog 行，返回可操作错误而不是静默删除。
- “删除自定义价格”和“恢复官方价”使用不同的 IPC/按钮语义，避免误导。

## 错误处理与兼容性

- 所有新拒绝都返回不含密钥的可操作错误；不把 URL、Authorization header 或明文凭证写入日志。
- v3 迁移需覆盖已有 v1/v2 数据库、重复行选择规则和重启幂等性。
- 不改变现有 `window.api` 明文凭证隔离；若必须扩展 IPC，增加 schema、preload 类型和 handler 测试。

## 测试策略

每个域按 TDD 执行：先写最小失败测试，确认失败原因，再写最小实现，最后运行定向测试和全量测试。

- Origin：官方域名、HTTP/HTTPS、localhost/私网、origin 变化时缺少新凭证、Admin extra credential 重新确认。
- Migration：真实 SQLite 多 Key 同日同模型、同 Key 多上游维度、旧库升级、重复运行迁移。
- Claude：半行同步后追加、UTF-8 边界、文件截断/轮转、完整行重复同步。
- Pagination：OpenAI/Anthropic 两页 cursor 合并、最大页数、第二页失败、重复页面。
- Pricing：按 ID 编辑、catalog 编辑转 user、唯一键变更、restore 恢复、无 catalog 行错误。

## 验收标准

- 上述五个域的定向测试全部通过，且每个新增测试曾在实现前失败。
- `npm run typecheck`、`npm run lint`、`npm run format:check`、`npm test`、`npm run build` 全部通过。
- `git status` 只包含本次明确提交的源文件、测试、文档。
- 不出现明文密钥日志；旧数据库可以启动并完成迁移。

## 后续阶段（不纳入本首阶段规格）

- `refreshAll` single-flight、告警事务、Provider/汇率超时和 Retry-After 上限。
- 现金余额与 Token 单位隔离、跨页排序/导出和 Renderer 错误状态。
- Playwright `_electron.launch()` 真实 Electron E2E。
- Electron/Vite/Vitest/electron-builder 升级、产物签名与发布校验。
