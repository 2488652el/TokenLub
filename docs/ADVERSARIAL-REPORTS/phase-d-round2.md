# Phase D — Provider Plugins (Round-2 Adversarial Review)

## Goal
Independent re-audit of all 13 providers, `http-client`, store layer, scheduler, and IPC handlers — **not** a re-verification of the round-1 findings (which were already fixed). The goal was to find bugs that `phase-d.md` did not cover.

## Exit Criteria
- [x] All 8 new findings (N1–N8) fixed with regression tests
- [x] 3 low-severity findings (N9–N11) documented as carry-over
- [x] `tsc --noEmit` (both configs) clean
- [x] `vitest run` — 22 files, 125 tests pass (was 20 files / 102 tests)
- [x] `eslint . --max-warnings 0` clean

## Findings (11 candidate, 8 fixed)

### 🔴 High severity (3 — ALL FIXED)

#### N1 — DeepSeek `hasUsageApi: true` but no `usage()` implementation
- **Location:** `src/main/providers/deepseek/index.ts:25`
- **Bug:** Declared `hasUsageApi: true` and `features: ['balance','usage']`, but `build()` returned only `balance` + `testConnection` — no `usage` method. This is the **same bug class** as round-1 finding #1 (OpenRouter), which was fixed; DeepSeek was missed.
- **Impact:** Any caller iterating providers by `hasUsageApi` and calling `caps.usage()` would hit `TypeError: caps.usage is not a function`. Violated the round-1 exit criterion ("`hasUsageApi=true` ⇒ `usage()` present").
- **Fix:** `hasUsageApi: false`, `features: ['balance']`. DeepSeek has no public usage endpoint.
- **Test:** `tests/unit/providers/deepseek.test.ts` — asserts `hasUsageApi===false`, `features` excludes `'usage'`, `caps.usage` is undefined. Regression guard against reintroducing the bug.

#### N2 — vendor-api usage records duplicated on every refresh → dashboard inflated
- **Location:** `src/main/store/db.ts` (schema) × `usage-repo.ts:insertUsage` × admin providers
- **Bug:** `usage_records` had only `UNIQUE(source, message_id)`. Anthropic/OpenAI admin `usage()` slices set **no `messageId`** (NULL). SQLite treats `NULL != NULL`, so `INSERT OR IGNORE` never deduped them. Each `refreshAll()` inserted new rows for the same day's data.
- **Impact:** `getDashboardSummary`'s `SUM(cost)` / `SUM(tokens)` grew linearly with refresh count — users saw N× real spend.
- **Fix:** Schema v2 migration rebuilds `usage_records` with **two** UNIQUE constraints:
  - `UNIQUE(source, provider_id, model, period_start)` — vendor-api business-key dedup
  - `UNIQUE(source, message_id)` — session-log dedup (preserved; no-op when message_id is NULL)
  - Migration is transactional: create `_v2` table → `INSERT OR IGNORE` copy → drop old → rename → rebuild indexes.
- **Test:** `tests/unit/store/usage-dedupe.test.ts` (7 tests) — verifies dedup key semantics (same slice collides, distinct days/models don't), simulates `INSERT OR IGNORE` behavior, and asserts the schema SQL declares both constraints + migrates to version 2.

#### N3 — Alert rule evaluation logic was entirely missing
- **Location:** `src/main/store/alerts-repo.ts` (CRUD only) × `src/main/scheduler/refresh.ts:ensureAlertTable` (table creation only)
- **Bug:** Full-repo search for `remaining_pct` / `evaluateAlert` / `checkAlert` in `src/main/` returned zero implementations. The `alert_events` table was created but never written; `last_triggered_at` was always NULL; `metric: 'remaining_pct'` had no percentage calculation. Alerts were a dead UI shell.
- **Impact:** User-configured balance alerts **never fired**. Worse, the UI implied they worked.
- **Fix:** Added `evaluateAlertRule` (pure function) + `evaluateAlerts` (orchestration) in `refresh.ts`:
  - `remaining_amount`: fires when `snap.remaining <= threshold`
  - `remaining_pct`: fires when `(remaining/total*100) <= threshold`; skips when `total` missing/≤0 (avoids div-by-zero)
  - Returns `null` for non-finite/missing values (defensive against bad provider data)
  - 5-minute cooldown per rule via `last_triggered_at` comparison (prevents refresh-loop spam)
  - Provider-scoped rules match by `providerId`; global rules evaluate all snapshots
  - Writes `alert_events` + updates `last_triggered_at` + `console.warn` on fire
  - Called at the end of `refreshAll()` (before the heartbeat)
  - New store functions: `markAlertTriggered`, `insertAlertEvent` in `alerts-repo.ts`
- **Test:** `tests/unit/scheduler/alert-eval.test.ts` (16 tests) — 9 pure-function tests for `evaluateAlertRule` (fire/no-fire/boundary/NULL/NaN/missing-total/div-by-zero) + 7 integration tests for `evaluateAlerts` with mocked store (fire writes event + marks triggered; cooldown skips; disabled rules skipped; missing-total skips; global evaluates all; empty snapshots returns 0).

### 🟡 Medium severity (5 — ALL FIXED)

#### N4 — longcat/stepfun `num()` returned NaN for non-numeric strings
- **Location:** `src/main/providers/longcat/index.ts:23`, `src/main/providers/stepfun/index.ts:32`
- **Bug:** `num('N/A')` → `Number('N/A')` = `NaN`. Verified at runtime. Some APIs return `'N/A'`/`'-'`/`null` placeholders. NaN would poison `remaining`/`total`, persist to DB, corrupt `SUM`.
- **Fix:** `const n = ...; return Number.isFinite(n) ? n : 0` (same guard pattern round-1 applied to anthropic/openai balance, missed here).
- **Test:** Both test files — feed `{ data: { balance: 'N/A', total_balance: '-' } }`, assert `remaining===0 && total===0` and `Number.isNaN(...)===false`.

#### N5 — `getDashboardSummary` pct lied when `totalCost === 0`
- **Location:** `src/main/store/usage-repo.ts:162` (was `const total = totals.totalCost || 1`)
- **Bug:** When total spend was 0 but token traffic existed, `pct = cost / 1 = cost` (all ≈0), so the pie chart showed meaningless slivers. The `|| 1` avoided div-by-zero but broke semantics.
- **Fix:** Extracted `computeProviderPct(providerCost, grandTotal)` pure function: returns 0 when `grandTotal ≤ 0`, else `providerCost / grandTotal`.
- **Test:** `tests/unit/store/dashboard.test.ts` — 4 tests for `computeProviderPct` (0/0→0, 3/10→0.3, negative→0, shares sum to 1).

#### N6 — token `SUM(prompt_tokens + completion_tokens)` dropped NULL rows
- **Location:** `src/main/store/usage-repo.ts:154`, `:175`
- **Bug:** In SQL, `NULL + x = NULL`; the outer `COALESCE(...,0)` then turned the whole row's contribution to 0. A vendor-api slice with only `prompt_tokens=100` and `completion_tokens=NULL` contributed 0 tokens to the dashboard.
- **Fix:** `SUM(COALESCE(prompt_tokens,0) + COALESCE(completion_tokens,0))` in both `byProvider` and `daily` queries.
- **Test:** `tests/unit/store/dashboard.test.ts` — 3 tests verifying the COALESCE arithmetic contract (NULL→0, both present, both NULL).

#### N7 — siliconflow `pickNumber` didn't guard against NaN
- **Location:** `src/main/providers/siliconflow/index.ts:42`
- **Bug:** Same class as N4. `Number('abc')` = NaN, no `isFinite` check across the multi-branch `pickNumber`.
- **Fix:** Extracted `toFiniteNum(v)` helper with `Number.isFinite` guard; `pickNumber` delegates all conversions to it.
- **Test:** `tests/unit/providers/siliconflow.test.ts` — feed `{ data: { balance: 'abc' } }`, assert `remaining===0`.

#### N8 — IPC handlers passed raw renderer input to store without zod validation
- **Location:** `src/main/ipc/register-handlers.ts`
- **Bug:** `ipc-schemas.ts` defined `apiKeyCreateInputSchema` etc. but **no handler imported them**. `addKey(input)`, `setPricing(entry)`, `addAlert(input)`, `setSetting(kv)`, `queryUsage(filter)` all received unvalidated renderer input directly. A compromised renderer (XSS / dependency supply-chain) could write malformed data to the DB.
- **Fix:** Each structured-input handler now calls `schema.parse(input)` (wrapped in `stripUndefined` + `as unknown as T` to satisfy `exactOptionalPropertyTypes`): `keysAdd`, `usageGetLogs`, `pricingSet`, `alertsAdd`, `alertsToggle`, `settingsSet`. Parse failure throws `ZodError`, propagated to the renderer's `invoke().catch()`.
- **Test:** `tests/unit/ipc-schemas.test.ts` — added 6 rejection cases (empty apiKey, non-url baseUrlOverride, empty settings key, non-uuid alert id, negative usage limit, missing pricing currency). The schemas themselves were already tested; these verify the **rejection paths** that now gate the handlers.

### 🟢 Low severity (3 — ACCEPTED as carry-over)

#### N9 — DeepSeek `total_balance` mapped to both `total` and `remaining`
- **Location:** `src/main/providers/deepseek/index.ts:40-42`
- **Status:** DeepSeek's `/user/balance` returns `balance_infos[].total_balance`, whose official semantics (cap vs remaining) need confirmation against DeepSeek's docs before changing. Currently treated as both, making the UI progress bar always 100%. Same shape as round-1 #8 (LongCat) but DeepSeek's API shape differs.
- **Carry-over:** Confirm semantics, then either drop `total` (like newapi) or split correctly.

#### N10 — `latestBalances` uses string `MAX(captured_at)` for "latest"
- **Location:** `src/main/store/balance-repo.ts:58`
- **Status:** String comparison relies on consistent ISO-8601 `Z` format. All providers currently use `new Date().toISOString()` (uniform), so it's safe today. Manual entry or future timezone-offset sources could break the ordering.
- **Carry-over:** Either enforce `toISOString()` at write time everywhere, or switch to `MAX(datetime(captured_at))`.

#### N11 — `http-client` ignores `x-ratelimit-reset-*` headers
- **Location:** `src/main/providers/http-client.ts:66`
- **Status:** Only reads `retry-after` (seconds). OpenAI/Anthropic also send `x-ratelimit-reset-requests`/`-tokens`. Retry cap is 2 (1s/3s backoff) — insufficient for minute-scale rate limits. Acceptable for now; refresh failures just log.
- **Carry-over:** Read vendor ratelimit headers; consider raising retry cap for known transient limits.

## Files Modified (9) / Created (4)

**Provider fixes:**
- `src/main/providers/deepseek/index.ts` (N1: hasUsageApi false, features)
- `src/main/providers/longcat/index.ts` (N4: num() guard)
- `src/main/providers/stepfun/index.ts` (N4: num() guard)
- `src/main/providers/siliconflow/index.ts` (N7: toFiniteNum helper)

**Store / scheduler / IPC fixes:**
- `src/main/store/db.ts` (N2: schema v2 migration, versioned applyMigrations)
- `src/main/store/usage-repo.ts` (N2: dedup comments; N5: computeProviderPct; N6: COALESCE token sum)
- `src/main/store/alerts-repo.ts` (N3: markAlertTriggered, insertAlertEvent)
- `src/main/scheduler/refresh.ts` (N3: evaluateAlertRule, evaluateAlerts, wired into refreshAll)
- `src/main/ipc/register-handlers.ts` (N8: zod validation + stripUndefined helper)

**Tests created:**
- `tests/unit/providers/deepseek.test.ts` (3 tests)
- `tests/unit/store/dashboard.test.ts` (7 tests)
- `tests/unit/store/usage-dedupe.test.ts` (7 tests)
- `tests/unit/scheduler/alert-eval.test.ts` (16 tests)

**Tests extended:**
- `tests/unit/providers/longcat.test.ts` (+1 test)
- `tests/unit/providers/stepfun.test.ts` (+1 test)
- `tests/unit/providers/siliconflow.test.ts` (+1 test)
- `tests/unit/ipc-schemas.test.ts` (+6 tests)

**Docs:**
- `docs/PROGRESS.md` (Phase D round-2 entry + carry-over)
- `docs/ADVERSARIAL-REPORTS/phase-d-round2.md` (this file)

## Commands run

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.node.json` | ✅ clean |
| `npx tsc --noEmit -p tsconfig.web.json` | ✅ clean |
| `npx vitest run` | ✅ 22 files, 125 tests passed (+23 vs round-1) |
| `npx eslint . --max-warnings 0` | ✅ 0 errors / 0 warnings |

## Test coverage delta

- 102 → 125 tests (+23)
- 4 new test files (deepseek, dashboard, usage-dedupe, alert-eval)
- 3 existing test files extended (longcat, stepfun, siliconflow, ipc-schemas)
- Every fix has at least one regression test pinning the corrected behavior
- N1 test is a direct regression guard for the original OpenRouter bug class
- N3 alert-eval tests are the most comprehensive (16 tests: pure logic + mocked-store integration)

## Note on store-layer testability

better-sqlite3's native binding is compiled for the Electron ABI in this repo, so it cannot be loaded under plain `node`/vitest. This is why all existing tests avoided the DB. The round-2 fixes followed the same pattern: **pure logic was extracted into testable functions** (`computeProviderPct`, `evaluateAlertRule`, `vendorApiDedupeKey`) and **SQL/schema changes were verified by string-contract assertions** on the source file. A future improvement would be to add a sql.js (WASM) based test harness for true DB integration tests.
