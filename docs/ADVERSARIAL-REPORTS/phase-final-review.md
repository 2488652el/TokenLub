# Final Adversarial Review — Pre-release Sweep

## Goal
Perform a final adversarial acceptance review across the completed Phase A–J codebase. Identify IPC/schema mismatches, security gaps, placeholder UI, functional bugs, and dead code that would block release; fix them and verify the project still passes lint, typecheck, tests, and build.

## Exit Criteria
- [x] `npm run lint` clean (max-warnings 0)
- [x] `npm run typecheck` clean for both `tsconfig.node.json` and `tsconfig.web.json`
- [x] `npm run test` — all 162 Vitest tests pass
- [x] `npm run format:check` — all matched files use Prettier style
- [x] `npm run build` — main / preload / renderer bundles produced
- [x] `npm run dist:win` — NSIS installer + portable executable produced
- [x] No hardcoded IPC channel strings outside `ipc-channels.ts`
- [x] `will-navigate` blocks arbitrary navigation in production builds
- [x] No empty/placeholder UI pages or non-functional controls left in release
- [x] Settings changes that affect runtime behavior take effect immediately

## Files added / modified

**IPC / schema / security:**
- `src/shared/ipc-channels.ts` — removed dead channels, added `balanceListLatest` and `providersList`
- `src/preload/index.ts` — replaced hardcoded channel strings with `IPC.*` constants
- `src/main/ipc/register-handlers.ts` — use `IPC.*` constants; restart auto-refresh when `refresh_interval_min` changes
- `src/main/scheduler/refresh.ts` — added `restartAutoRefresh()`; removed redundant `ensureAlertTable()`
- `src/main/index.ts` — removed `ensureAlertTable()` call; hardened `will-navigate` for production
- `src/main/store/alerts-repo.ts` — fixed stale comment about who creates `alert_events`

**Renderer placeholder UI wiring:**
- `src/renderer/pages/BalanceQuery.tsx` — fully wired per-key balance cards instead of static empty state
- `src/renderer/pages/Settings.tsx` — removed 4 non-functional notification toggles; kept working auto-refresh interval
- `src/renderer/pages/ProviderSummary.tsx` — removed placeholder subtitle text
- `src/renderer/pages/UsageAlerts.tsx` — corrected page description to match actual behavior
- `src/renderer/layout/Sidebar.tsx` — replaced hardcoded personal profile placeholder with generic app footer

**Tests / formatting:**
- `tests/unit/ipc-refresh-all.test.ts` — added `restartAutoRefresh` to the mocked scheduler module
- Applied `npm run format` across the codebase (36 files had pre-existing drift)

## Commands run

| Command | Result |
| --- | --- |
| `npm run lint` | ✅ clean |
| `npm run typecheck` | ✅ clean (both tsconfigs) |
| `npm run test` | ✅ 162 passed |
| `npm run format:check` | ✅ all matched files use Prettier style |
| `npm run build` | ✅ main 72.05 kB · preload 5.57 kB · renderer JS 585.28 kB + CSS 38.21 kB |
| `npm run dist:win` | ✅ `release/TokenLub-0.1.0-x64.exe` (82.24 MB) + `release/TokenLub-0.1.0-portable.exe` (82.03 MB) |

## Findings

### 🔴 CRITICAL — Hardcoded IPC channel strings in preload & main handlers
**Problem:** `src/preload/index.ts` and `src/main/ipc/register-handlers.ts` used raw strings for three channels (`usage:get-provider-summary`, `balance:list-latest`, `providers:list`) instead of the `IPC` constants. This is a runtime schema mismatch risk: renaming the constant would silently break those calls, and the `as typeof IPC.usageGetProviderSummary` assertion was just masking the issue (`typeof` of a string literal is `string`).

**Fix applied:**
1. Added `balanceListLatest` and `providersList` to `src/shared/ipc-channels.ts`.
2. Removed dead/unimplemented channels (`keysUpdate`, `usageRefreshOne`, `usageExportCsv`, `pricingCatalog`, `alertsTest`).
3. Replaced all hardcoded strings in `preload/index.ts` and `register-handlers.ts` with `IPC.*` constants and removed the misleading type assertions.

### 🔴 CRITICAL — Production `will-navigate` handler allowed arbitrary navigation
**Problem:** In `src/main/index.ts`, the `web-contents-created` `will-navigate` handler only took action when `isDev` was true. In a packaged production build (`isDev === false`), any navigation initiated inside the renderer — including malicious `window.location` changes or link clicks — would be allowed, potentially enabling phishing or remote-code execution vectors.

**Fix applied:** Rewrote the handler to always block navigation unless the URL matches the app's own origin: `http://localhost:5173` in development and `file:` in production. Blocked URLs are handed to `shell.openExternal` only if their scheme is `http:`, `https:`, or `mailto:`.

### 🔴 CRITICAL — Placeholder / non-functional UI elements remained in release
**Problem:** Several renderer surfaces still contained placeholders or controls that did nothing:

1. **`BalanceQuery.tsx`** — entire page was a static "尚未添加任何 Key" empty state regardless of actual data.
2. **`Settings.tsx`** — four notification toggles (`notify.token_exceeded`, `notify.daily_summary`, `notify.request_errors`, `notify.provider_down`) were rendered and bound to `settings.set`, but no backend code reads or acts on those keys.
3. **`ProviderSummary.tsx`** — Top-5 card subtitle contained `（占位 — 等待 Agent 维度）`.
4. **`UsageAlerts.tsx`** — page description claimed "阈值规则触发原生通知", but the scheduler only writes `alert_events` rows; no OS/in-app notification is triggered.
5. **`Sidebar.tsx`** — bottom card showed hardcoded personal info (surname 郑, "个人信息及配置", free-quota date 07-01) that is irrelevant to other users.

**Fix applied:**
- `BalanceQuery.tsx` → loads keys + balances and renders per-key balance cards with remaining/used/total/token count and snapshot time.
- `Settings.tsx` → removed the four non-functional notification toggles; kept the working auto-refresh interval selector.
- `ProviderSummary.tsx` → replaced placeholder subtitle with plain "按费用降序".
- `UsageAlerts.tsx` → updated description to "阈值规则触发时写入告警事件".
- `Sidebar.tsx` → replaced the personal card with a generic app footer: "TokenLub / 本地加密 · 安全聚合 / v{window.api.version}".

### 🟡 HIGH — Auto-refresh interval change required app restart
**Problem:** `startAutoRefresh()` read `refresh_interval_min` once at app startup and started a `setInterval` timer. Changing the interval in Settings wrote the new value to the DB but the running timer never updated, so the user had to restart the app for the change to take effect.

**Fix applied:**
- Added `clearAutoRefresh()` and `restartAutoRefresh()` to `src/main/scheduler/refresh.ts`.
- In `register-handlers.ts`, the `settings:set` handler now calls `restartAutoRefresh()` when the changed key is `refresh_interval_min`.

### 🟡 MEDIUM — Dead IPC channel constants
**Problem:** `ipc-channels.ts` defined `keysUpdate`, `usageRefreshOne`, `usageExportCsv`, `pricingCatalog`, and `alertsTest`, but none were registered in the main process, exposed in preload, or used in the renderer. They created the illusion of implemented features.

**Fix applied:** Removed the five dead channel entries from `ipc-channels.ts`.

### 🟢 LOW — Redundant `ensureAlertTable()` and stale comment
**Problem:** `src/main/scheduler/refresh.ts` exported `ensureAlertTable()`, which was called in `src/main/index.ts`. However, `alert_events` has been part of the schema migrations in `src/main/store/db.ts` since v1, so the extra `CREATE TABLE IF NOT EXISTS` was redundant. A comment in `src/main/store/alerts-repo.ts` still incorrectly stated the table was created by `refresh.ensureAlertTable()`.

**Fix applied:**
- Removed `ensureAlertTable()` from `refresh.ts`.
- Removed the call from `main/index.ts`.
- Updated the stale comment in `alerts-repo.ts` to reference `store/db` migrations.

### 🟢 LOW — Pre-existing Prettier formatting drift
**Problem:** `npm run format:check` reported 36 files with style drift, meaning staged files would fail the pre-commit hook.

**Fix applied:** Ran `npm run format` once across the whole codebase.

## Fixes applied

| Finding | Severity | Files changed | Verified by |
| --- | --- | --- | --- |
| Hardcoded IPC channel strings | 🔴 Critical | `ipc-channels.ts`, `preload/index.ts`, `register-handlers.ts` | `npm run typecheck`, `npm run test` |
| Production `will-navigate` bypass | 🔴 Critical | `src/main/index.ts` | `npm run typecheck`, manual code review |
| Placeholder / non-functional UI | 🔴 Critical | `BalanceQuery.tsx`, `Settings.tsx`, `ProviderSummary.tsx`, `UsageAlerts.tsx`, `Sidebar.tsx` | `npm run lint`, `npm run typecheck`, `npm run build` |
| Auto-refresh interval not reactive | 🟡 High | `refresh.ts`, `register-handlers.ts` | `npm run test`, `npm run typecheck` |
| Dead IPC channel constants | 🟡 Medium | `ipc-channels.ts` | `npm run typecheck`, grep |
| Redundant `ensureAlertTable()` | 🟢 Low | `refresh.ts`, `main/index.ts`, `alerts-repo.ts` | `npm run test`, `npm run typecheck` |
| Prettier drift | 🟢 Low | 36 files across `src/` and `tests/` | `npm run format:check` |

## Follow-up: parallel agent run (carry-overs resolved)

After the initial report, a parallel multi-agent run addressed the previously accepted carry-overs:

| Task | Agent | Files changed | Result |
| --- | --- | --- | --- |
| SessionParse 实时进度 | #1 | `src/renderer/pages/SessionParse.tsx` | 订阅 `onSyncProgress` / `onSyncDone`，显示文件数、进度文本、完成总计/错误 |
| AgentDetail 延迟占位 | #2 | `src/renderer/pages/AgentDetail.tsx` | 将无意义的 "平均响应" 替换为 "平均每次请求 Tokens" |
| ProviderSummary 精确趋势 | #3 | `src/shared/utils/provider-aggregation.ts`, `src/renderer/pages/ProviderSummary.tsx`, `tests/unit/provider-summary.test.ts` | 新增 `providerWeekWindows()`，按 Provider 精确计算近 7 天 vs 上 7 天成本 |
| RequestLogs 导出全部 + 服务端搜索 | #4 | `src/shared/ipc-schemas.ts`, `src/main/store/usage-repo.ts`, `src/renderer/pages/RequestLogs.tsx`, `tests/unit/ipc-schemas.test.ts` | 增加 `modelContains` 服务端过滤；CSV 导出使用完整服务端结果 `logs`；搜索框 400ms 防抖 + Enter/Blur 立即提交 |
| dist:win 打包验证 | #5 | `release/*` artifacts | 成功生成 NSIS 安装包 + 便携版可执行文件 |
| 测试与文档 | #6 | `tests/unit/scheduler/refresh-auto.test.ts`, `docs/PROGRESS.md` | 新增 `startAutoRefresh` / `restartAutoRefresh` 定时器测试；更新进度文档 |

All parallel changes were integrated and re-verified:
- `npm run lint` ✅
- `npm run typecheck` ✅
- `npm run test` ✅ 162 passed (up from 155)
- `npm run format:check` ✅
- `npm run build` ✅

## Carry-overs / accepted limitations

- `RequestLogs.tsx` server-side search is currently a simple `LOWER(model) LIKE LOWER(?)` substring match; full-text or indexed search is a future enhancement.
- `SessionParse.tsx` progress UI is text-based; a future enhancement may add a progress bar or per-file list.
- The portable / installer builds use the default Electron icon because `build/icon.ico` is intentionally absent per README.
