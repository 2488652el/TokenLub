# Implementation Progress

## Phase A — Scaffold
- [x] Exit criteria met (electron-vite build green, both typecheck configs green)
- [x] Adversarial review complete (see phase-a.md)

## Phase B — Design Migration (AppShell, Sidebar, Topbar)
- [x] Exit criteria met (visual diff vs tokenlub-design.html ≤ 5px, 11 pages render distinct layouts)
- [x] Adversarial review complete (see phase-b.md — 7 actionable findings, all fixed)

## Phase C — Storage & IPC
- [x] SQLite migrations applied (9 tables: api_keys, balance_snapshots, usage_records, pricing_entries, alert_rules, log_sync_state, app_settings, schema_version, alert_events)
- [x] safeStorage round-trip works (keys-repo + crypto/safe-storage.ts)
- [x] Preload exposes typed window.api (src/preload/index.ts, 41-channel surface)
- [x] Adversarial review complete

## Phase D — Provider Plugins
- [x] DeepSeek live (Phase C)
- [x] Zhipu live (Phase C)
- [x] Manual (Phase C)
- [x] Moonshot / Kimi (probes 3 endpoints, USD for api.moonshot.ai)
- [x] SiliconFlow
- [x] OpenRouter
- [x] StepFun 阶跃星辰
- [x] Anthropic Admin (sk-ant-admin + usage-cost beta header)
- [x] OpenAI Admin (sk-admin + unix timestamps)
- [x] LongCat
- [x] NewAPI / OneAPI Generic (1 quota = 0.002 USD; no fake total)
- [x] Qwen Manual (no API — user enters)
- [x] Gemini Manual (no API — user enters)
- [x] ~~MiniMax~~ removed (placeholder, no real public API)
- [x] **Round-2 adversarial review** (8 new findings fixed, 3 carried over):
  - N1 DeepSeek `hasUsageApi` was true with no `usage()` impl → set false
  - N2 vendor-api usage deduped by business key (schema v2 migration, `UNIQUE(source, provider_id, model, period_start)`)
  - N3 alert evaluation loop implemented (`evaluateAlerts`/`evaluateAlertRule` in refresh scheduler + `markAlertTriggered`/`insertAlertEvent` in alerts-repo; 5-min cooldown)
  - N4/N7 longcat/stepfun/siliconflow `num()`/`pickNumber` NaN guards (`Number.isFinite`)
  - N5 dashboard `pct` divide-by-zero fix (`computeProviderPct`: returns 0 when grandTotal ≤ 0)
  - N6 token sum NULL fix (`SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0))`)
  - N8 IPC handlers zod-validate structured inputs (keysAdd, usageGetLogs, pricingSet, alertsAdd, alertsToggle, settingsSet)
  - Carry-over: N9 DeepSeek total_balance semantics (needs official API confirmation), N10 latestBalances time-string compare (safe while all sources use toISOString), N11 http-client ratelimit header reading

## Phase D2 — Local Log Parsers
- [x] Claude Code JSONL parser (parseClaudeSessionLine/File, discover, syncClaudeFile — Buffer byte-offset slicing)
- [x] Codex CLI JSONL parser (cumulative→delta conversion, inclusive-cache subtraction, sessionId-prefixed messageId)
- [x] CLI auth detector (detectClaudeKey/detectCodexKey + maskKey; fullKey stays in main process)
- [x] sync.ts orchestration (log_sync_state incremental tracking + fast-path mtime/size skip)
- [x] IPC wired: logDiscover, logSync (try/catch + logSyncDone on error), logDetectClaudeKey/CodexKey (strip fullKey), logOpenFolder (directory-only validation), keys:import-from-cli
- [x] Adversarial review complete (9 findings: 4 high fixed, 1 medium accepted, 4 low accepted)

## Phase E — Dashboard page (online + local 双源)
- [x] Dashboard 真实数据(usage.getDashboard 7d + balance.latest + CSS bar chart)
- [x] Provider Summary(usage.getDashboard 30d + conic-gradient donut + Top-5 by cost)
- [x] Agent Detail(usage.getLogs session-log → 按 sessionId 聚合)
- [x] Model Compare(usage.getLogs → 按 model 聚合)
- [x] Sidebar 动态 Agent badge(从 session-log 派生)
- [x] EmptyState 新增 action slot
- [x] fmtCount 中文紧凑格式器(亿/万/无单位)
- [x] 130 测试全过(新增 4 个 fmtCount)

## Phase F — Provider Aggregation page (expand)
- [x] 3-tab 切换器:By Provider / By Model / By Cost Trend
- [x] 日期范围筛选:本月/本周/今日
- [x] By Provider:donut + Top-5 + 每 provider 的 top-3 model + trend 列
- [x] By Model:跨 provider 按 model 聚合(provider pills)
- [x] By Cost Trend:30 天 daily bar chart(高亮最高/最低)
- [x] 17 个新 unit 测试(provider-summary.test.ts)
- [x] Tabs 组件(role=tablist + accent border)
- [x] 147 测试全过(+17 新)

## Phase I — Settings + Alerts pages
- [x] Settings 4 toggles 已绑 `settings.get`/`set` 带 rollback
- [x] Settings 余额自动刷新间隔 select(关闭/15/30/60 分钟 → `refresh_interval_min`)
- [x] UsageAlerts 完整 CRUD:list / create / toggle / delete
- [x] RuleModal(scope + provider + metric + threshold,带 provider 条件显示 + 校验)
- [x] 阈值展示:金额用 `fmtMoney`(自动从 `balance.latest` 取 currency),百分比用 `${n}%`
- [x] ScopeBadge / MetricLabel / inline `formatRelative`(`刚刚/N 分钟前/N 小时前/N 天前/从未`)
- [x] 乐观更新 + 失败回滚模式
- [x] Carry-over:`alerts.update` IPC(主进程 addAlert 只 insert,无 upsert;目前 edit 走 delete+create)

## Phase H — Pricing Config page (full CRUD)
- [x] 完整 CRUD:Add / Edit / Delete / Restore-to-catalog
- [x] 价格表(Provider | Model | 4 价格列 | Currency | Source badge | Updated | Actions)
- [x] Provider + Currency 双重 filter chips
- [x] Add/Edit Modal(Provider select + Model + Currency + 4 数字字段,非空/非负校验)
- [x] "恢复官方价"按钮(确认 → 批量 sequential delete user-sourced)
- [x] Source badge(catalog 灰 / user 绿)
- [x] EmptyState + CTA "添加第一条价格"
- [x] Carry-over:`pricing.restore` IPC 实际是 delete(命名误导),真 "restore from catalog" 需要新 IPC

## Phase G — API Keys UI (full CRUD + 本机 CLI 导入 + admin key)
- [x] CRUD:list / add / delete / test(完整)
- [x] 导入 CLI 按钮(Claude / Codex)
- [x] 搜索 + Provider filter chips
- [x] **Admin Key 第二输入框**(`anthropic-admin` / `openai-admin` 显示,带 shield 图标 + hint)
- [x] 高级折叠:Base URL Override
- [x] Notes 字段(可选,500 字)
- [x] Source badge 三种变体
- [x] Delete 确认显示 key 末位
- [x] EmptyState 三按钮 CTA
- [x] ApiKeyCreateInput 加 `extra?: Record<string,string>` 字段
- [x] Carry-over:`addKey()` 主进程接管 `extra.adminKey` + DB 列 + provider 路径

## Phase J — Request Logs (full table + filters)
- [x] 10 列日志表(Time/Provider/Model/Source/4 token/Cost/Currency)
- [x] Time + Cost 排序(默认 Time desc)
- [x] Filter bar:Provider chips + Source chips + 日期范围 + model 搜索 + 清空
- [x] EmptyState CTA 双绑 `log.sync('claude-code')` + `log.sync('codex')`
- [x] Detail Modal(显示全部字段 + 复制 raw JSON)
- [x] CSV 导出(BOM-prefixed for Excel-on-Windows,Blob 下载)
- [x] 加载更多(limit 倍增到 10000 cap)
- [x] Carry-over:pagination offset/cursor、CSV 流式导出、服务端 model 搜索

## Final
- [x] Ponytail polish (eslint clean, tsc clean both configs, 147 tests pass, build green, dead exports removed)
- [x] Final adversarial sweep clean (no console leaks of secrets, no unhandled promise rejections, no POSIX-only paths)
- [x] **Post-sweep adversarial review** (`docs/ADVERSARIAL-REPORTS/phase-final-review.md`):
  - Fixed hardcoded IPC channel strings and removed dead channels
  - Hardened production `will-navigate` to block arbitrary navigation
  - Removed/wired placeholder UI in `BalanceQuery`, `Settings`, `ProviderSummary`, `UsageAlerts`, `Sidebar`
  - Made auto-refresh interval reactive via `restartAutoRefresh()`
  - Removed redundant `ensureAlertTable()`
  - Applied `npm run format` to fix 36 files of drift
  - Final verification: lint ✅, typecheck ✅, 155 tests ✅, format:check ✅, build ✅

## Parallel agent follow-up (carry-overs resolved)
- [x] `SessionParse.tsx` — live sync progress via `onSyncProgress` / `onSyncDone`
- [x] `AgentDetail.tsx` — replaced latency placeholder with "平均每次请求 Tokens"
- [x] `ProviderSummary.tsx` + `provider-aggregation.ts` — exact per-provider week-over-week trend
- [x] `RequestLogs.tsx` + `usage-repo.ts` + `ipc-schemas.ts` — server-side `modelContains` filter + full-result CSV export
- [x] `dist:win` packaging verified — `release/TokenLub-0.1.0-x64.exe` + `TokenLub-0.1.0-portable.exe`
- [x] Added `tests/unit/scheduler/refresh-auto.test.ts` for auto-refresh timer behavior
- [x] Re-verification: lint ✅, typecheck ✅, 162 tests ✅, format:check ✅, build ✅, dist:win ✅

## Tests & Docs — Auto-refresh follow-up
- [x] Added `tests/unit/scheduler/refresh-auto.test.ts` covering:
  - `startAutoRefresh` uses `refresh_interval_min` to schedule `refreshAll`
  - `restartAutoRefresh` cancels the old timer and restarts with the updated interval
  - Fake timers + mocked store dependencies (no DB / no network)
- [x] `docs/PROGRESS.md` updated with this follow-up entry
- [x] `AGENTS.md` reviewed: no project-root file exists; no update needed

## Cross-file observations (Phase I in-flight files)
- `Settings.tsx` + `UsageAlerts.tsx` are being edited by a parallel agent for Phase I;
  intentionally skipped from this polish pass to avoid conflicting edits. Both pass lint
  and typecheck in their current state. Notes for the Phase I owner:
  - Both files define their own `Toggle` subcomponent with identical markup (~25 LOC each).
    This is a minor duplication; deduplicating would require a new shared component, which
    Ponytail forbids during polish. Worth a follow-up cleanup.
  - `Settings.tsx`: optimistic `setPrefs` + IPC + rollback on failure is correct.
  - `UsageAlerts.tsx`: same optimistic + rollback pattern in `handleToggle`/`handleDelete` —
    correct.
