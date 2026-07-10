# TokenLub 对抗式审查修复实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 按已批准设计修复 TokenLub 对抗式审查发现的凭证、数据完整性、Provider、Renderer 和发布风险。

**Architecture:** 保持 Electron Main / Preload / Renderer 三进程边界。安全策略和凭证接收方校验留在 Main；SQLite 通过幂等迁移升级；Renderer 只消费类型化 IPC。每个任务先添加失败测试，再实现最小改动并独立复核。

**Tech Stack:** TypeScript 5.5+, Electron 31, better-sqlite3, Zod, React 18, Vitest, Playwright, electron-builder。

## Global Constraints

- 不在日志、测试输出或源码中写入真实密钥、Cookie、Admin Key 或完整 CLI Key。
- 官方 Provider 只允许官方 HTTPS origin；`newapi-generic` 可使用 HTTP(S)、localhost 和内网地址。
- 已保存凭证发生 origin 变化时，必须重新提交对应凭证；Main 侧校验优先于 Renderer 校验。
- 数据库迁移必须兼容 v1-v5、幂等、可回滚失败事务，并保留可解释的数据选择规则。
- 每个行为变更必须遵循 RED → GREEN → 定向测试 → 全量测试；不得只增加超时掩盖失败。
- 首阶段不做跨层大重构；每个任务只修改其列出的文件及必要测试/文档。
- 使用现有 canonical `artifacts/dist` 仅在明确需要打包时；副产物目录必须使用 `artifacts/Zcode-*`。

---

### Task 1: Main 侧 Provider origin 绑定与凭证变更保护

**Files:**
- Create: `src/main/providers/endpoint-policy.ts`
- Modify: `src/main/ipc/register-handlers.ts:80-105`
- Modify: `src/main/store/keys-repo.ts:191-224`
- Modify: `src/shared/ipc-schemas.ts:8-27`
- Modify: `src/shared/types/api-key.ts:50-64`
- Test: `tests/unit/endpoint-policy.test.ts`
- Test: `tests/unit/ipc-schemas.test.ts`
- Test: `tests/unit/keys-extra.test.ts` or a new focused update test

**Interfaces:**
- Produce `validateProviderEndpoint(providerId: string, rawUrl: string | null | undefined): { ok: true; origin: string } | { ok: false; reason: string }`.
- Produce `originChanged(providerId: string, existingUrl: string | null | undefined, nextUrl: string | null | undefined): boolean`.
- Main update handler must reject an origin change when `apiKey` is omitted and the provider requires a credential re-entry.

- [ ] **Step 1: Write failing policy tests**

Add tests for:

```ts
expect(validateProviderEndpoint('deepseek', 'https://api.deepseek.com').ok).toBe(true)
expect(validateProviderEndpoint('deepseek', 'http://api.deepseek.com').ok).toBe(false)
expect(validateProviderEndpoint('deepseek', 'http://127.0.0.1:3000').ok).toBe(false)
expect(validateProviderEndpoint('newapi-generic', 'http://127.0.0.1:3000').ok).toBe(true)
expect(validateProviderEndpoint('newapi-generic', 'file:///C:/x').ok).toBe(false)
```

Add an update-handler test proving an existing encrypted key cannot be rebound to a new origin without a replacement credential.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/endpoint-policy.test.ts tests/unit/ipc-schemas.test.ts tests/unit/keys-extra.test.ts --reporter=verbose`; the new policy and update tests must fail for the current permissive behavior.

- [ ] **Step 3: Implement minimal Main-side policy**

Keep the Zod schema structural. In the handler, load the existing record and compare normalized origins before calling `updateKey`. Validate the new URL before persistence. Treat clearing an existing origin as an origin change for non-manual providers. Do not include URL or credential values in thrown errors.

- [ ] **Step 4: Run GREEN and regression checks**

Run the focused command from Step 2, then `npm run typecheck` and `npm test`.

- [ ] **Step 5: Commit**

`git add src/main/providers/endpoint-policy.ts src/main/ipc/register-handlers.ts src/main/store/keys-repo.ts src/shared/ipc-schemas.ts src/shared/types/api-key.ts tests/unit/endpoint-policy.test.ts tests/unit/ipc-schemas.test.ts tests/unit/keys-extra.test.ts && git commit -m "fix: bind stored credentials to provider origins"`

### Task 2: Usage schema v6 migration and lossless vendor dedupe

**Files:**
- Modify: `src/main/store/db.ts:204-244`
- Modify: `src/main/store/usage-repo.ts:160-220`
- Modify: `src/shared/types/usage.ts`
- Modify: `src/main/providers/openai-admin/index.ts`
- Modify: `src/main/providers/anthropic-admin/index.ts`
- Test: `tests/unit/store/db-migration.test.ts`
- Test: `tests/unit/store/usage-dedupe.test.ts`
- Test: `tests/unit/providers/openai-admin.test.ts`
- Test: `tests/unit/providers/anthropic-admin.test.ts`

**Interfaces:**
- Extend `UsageRecord` with an optional stable upstream dimension/record identifier that can be persisted without changing session-log semantics.
- New migration version must replace the vendor uniqueness constraint with a key that includes `api_key_id` and the provider result dimension.
- `insertUsage` must return `{ inserted: number; updated: number; skipped: number }` or preserve the existing return shape while making update behavior explicit in tests.

- [ ] **Step 1: Write failing real-SQLite tests**

Using `applyMigrationsForTest` and an in-memory SQLite connection, assert two different `api_key_id` values with the same provider/model/period both survive. Assert two provider results with different upstream dimensions both survive, and repeating the same dimension updates rather than duplicates. Assert migration v6 is idempotent.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/store/db-migration.test.ts tests/unit/store/usage-dedupe.test.ts --reporter=verbose`; the current v2 uniqueness must reject the second Key row.

- [ ] **Step 3: Implement migration and write path**

Add a transactional migration after the current latest version. Rebuild `usage_records` only when necessary, preserve existing session-log rows, and choose a deterministic survivor for legacy collisions. Add the new upstream dimension columns only if the provider payload can populate them; otherwise use an explicit stable fallback. Replace `INSERT OR IGNORE` for vendor rows with a conflict target and update clause that cannot cross Key or result dimensions.

- [ ] **Step 4: Add provider mapping tests and run GREEN**

Mock multi-result OpenAI/Anthropic responses and assert every result maps to a distinct persisted dimension. Run the focused store/provider tests, then `npm run typecheck` and `npm test`.

- [ ] **Step 5: Commit**

`git add src/main/store/db.ts src/main/store/usage-repo.ts src/shared/types/usage.ts src/main/providers/openai-admin/index.ts src/main/providers/anthropic-admin/index.ts tests/unit/store/db-migration.test.ts tests/unit/store/usage-dedupe.test.ts tests/unit/providers/openai-admin.test.ts tests/unit/providers/anthropic-admin.test.ts && git commit -m "fix: preserve vendor usage across keys and result dimensions"`

### Task 3: Claude incremental tail and rotation correctness

**Files:**
- Modify: `src/main/log-parsers/claude.ts:215-231`
- Modify: `src/main/log-parsers/sync.ts:94-107`
- Test: `tests/unit/log-parsers/claude.test.ts`
- Test: `tests/unit/log-parsers/sync.test.ts`

**Interfaces:**
- Keep `syncClaudeFile(filePath, byteOffset)` return type, but guarantee `nextOffset` ends at a complete newline.
- Keep `syncFiles` persistence contract; a truncated file must rescan from zero instead of advancing to the replacement EOF.

- [ ] **Step 1: Write failing tests**

Test a partial JSON line followed by a later append; the first sync returns no partial record and the second returns exactly one complete record. Test a file whose current size is smaller than the saved offset and assert the replacement content is parsed.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/log-parsers/claude.test.ts tests/unit/log-parsers/sync.test.ts --reporter=verbose`; current implementation advances to `st.size` and the new tests fail.

- [ ] **Step 3: Implement bounded parsing**

Read from the saved byte offset, find the last newline byte, parse only that slice, and return the offset immediately after it. If no complete newline exists, return the original offset. If `st.size < byteOffset`, reset to zero before reading.

- [ ] **Step 4: Run GREEN and regression checks**

Run the focused parser tests, then `npm run typecheck` and `npm test`.

- [ ] **Step 5: Commit**

`git add src/main/log-parsers/claude.ts src/main/log-parsers/sync.ts tests/unit/log-parsers/claude.test.ts tests/unit/log-parsers/sync.test.ts && git commit -m "fix: retain incomplete Claude log tails"`

### Task 4: Admin Provider cursor pagination

**Files:**
- Modify: `src/main/providers/openai-admin/index.ts:90-150`
- Modify: `src/main/providers/anthropic-admin/index.ts:85-130`
- Test: `tests/unit/providers/openai-admin.test.ts`
- Test: `tests/unit/providers/anthropic-admin.test.ts`

**Interfaces:**
- Keep provider `usage(fromISO, toISO)` and `balance()` return contracts.
- Add local constants for `MAX_ADMIN_PAGES` and `MAX_ADMIN_ITEMS`; do not expose pagination details to Renderer.

- [ ] **Step 1: Write failing two-page tests**

Mock page one with `has_more: true` and `next_page: 'cursor-2'`, page two with `has_more: false`; assert two HTTP calls and merged totals. Add a page-limit test and a second-page error test.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/providers/openai-admin.test.ts tests/unit/providers/anthropic-admin.test.ts --reporter=verbose`; current code makes one request.

- [ ] **Step 3: Implement cursor loops**

Create a private per-provider page loop using the existing HTTP client. Pass the cursor exactly as the upstream API expects, stop at `has_more === false`, throw on a page error, and stop with a bounded error when the page/item cap is exceeded. Deduplicate repeated upstream records before mapping to slices.

- [ ] **Step 4: Run GREEN and regression checks**

Run focused provider tests, then `npm run typecheck` and `npm test`.

- [ ] **Step 5: Commit**

`git add src/main/providers/openai-admin/index.ts src/main/providers/anthropic-admin/index.ts tests/unit/providers/openai-admin.test.ts tests/unit/providers/anthropic-admin.test.ts && git commit -m "fix: paginate admin provider usage"`

### Task 5: Price CRUD and catalog restore semantics

**Files:**
- Modify: `src/shared/ipc-channels.ts`
- Modify: `src/shared/ipc-schemas.ts`
- Modify: `src/shared/types/pricing.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/main/ipc/register-handlers.ts:188-202`
- Modify: `src/main/store/pricing-repo.ts:80-145`
- Modify: `src/renderer/pages/PricingConfig.tsx:80-115,374-430`
- Test: `tests/unit/store/usage-pricing-config.test.ts`
- Test: `tests/unit/ipc-schemas.test.ts`

**Interfaces:**
- Add a typed `pricing:update(id, input)` IPC or extend `pricing:set` with an explicit ID; do not overload `pricing:restore` as delete.
- Add a typed restore result `{ restored: true; entry: PricingEntry } | { restored: false; reason: string }`.

- [ ] **Step 1: Write failing CRUD tests**

Test that editing an existing row by ID updates one row, changing its displayed values does not leave the old row, and manual edits persist with `source='user'`. Test restore removes the user override and recreates the matching catalog row; missing catalog data returns a structured error.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/store/usage-pricing-config.test.ts tests/unit/ipc-schemas.test.ts --reporter=verbose`; current set/upsert/delete behavior must fail these assertions.

- [ ] **Step 3: Implement typed update and restore**

Add repository functions `updatePricing(id, input)` and `restorePricing(id)`. Make the IPC handler validate IDs and return structured errors. Renderer edit mode must send the ID and always set `source='user'`; separate delete-user-entry and restore-catalog actions in the UI.

- [ ] **Step 4: Run GREEN and regression checks**

Run focused pricing tests, then `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`.

- [ ] **Step 5: Commit**

`git add src/shared/ipc-channels.ts src/shared/ipc-schemas.ts src/shared/types/pricing.ts src/preload/index.ts src/main/ipc/register-handlers.ts src/main/store/pricing-repo.ts src/renderer/pages/PricingConfig.tsx tests/unit/store/usage-pricing-config.test.ts tests/unit/ipc-schemas.test.ts && git commit -m "fix: make pricing edits and restores explicit"`

### Task 6: Refresh single-flight, timeouts, and alert transaction

**Files:**
- Modify: `src/main/scheduler/refresh.ts`
- Modify: `src/main/store/alerts-repo.ts`
- Modify: `src/main/services/exchange-rate.ts`
- Modify: `src/main/providers/longcat/index.ts`
- Modify: `src/main/providers/http-client.ts`
- Modify: `src/shared/ipc-schemas.ts`
- Test: `tests/unit/scheduler/refresh-auto.test.ts`
- Test: `tests/unit/scheduler/alert-eval.test.ts`
- Test: `tests/unit/http-client.test.ts`

**Interfaces:**
- `refreshAll()` returns the existing result shape but shares one in-flight Promise for overlapping callers.
- Settings schema accepts only `refresh_interval_min` values `0 | 15 | 30 | 60`.
- All provider/exchange-rate requests use finite AbortSignal timeouts; `Retry-After` is clamped to a bounded delay.

- [ ] **Step 1: Write failing concurrency/timeout tests**

Add `refreshAll shares an in-flight operation` using a deferred provider Promise and assert two callers invoke the provider once; add `settings rejects unsupported refresh intervals`; add `alert event and cooldown update are atomic`; add HTTP tests for a never-resolving exchange-rate/LongCat request and `Retry-After: 31536000` being clamped.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/scheduler/refresh-auto.test.ts tests/unit/scheduler/alert-eval.test.ts tests/unit/http-client.test.ts tests/unit/ipc-schemas.test.ts --reporter=verbose`; each new assertion must fail against the current implementation.

- [ ] **Step 3: Implement bounded refresh behavior**

Store a module-level in-flight Promise and return it to overlapping callers. Restrict `refresh_interval_min` to `0 | 15 | 30 | 60` in the settings handler and revalidate in the scheduler. Add `AbortSignal.timeout` or equivalent to direct fetches, clamp `Retry-After` to 30 seconds, and wrap alert insert plus cooldown update in one SQLite transaction.

- [ ] **Step 4: Run GREEN and regression checks**

Run the focused command from Step 2, then `npm run typecheck` and `npm test`.

- [ ] **Step 5: Commit**

`git add src/main/scheduler/refresh.ts src/main/store/alerts-repo.ts src/main/services/exchange-rate.ts src/main/providers/longcat/index.ts src/main/providers/http-client.ts src/shared/ipc-schemas.ts tests/unit/scheduler/refresh-auto.test.ts tests/unit/scheduler/alert-eval.test.ts tests/unit/http-client.test.ts tests/unit/ipc-schemas.test.ts && git commit -m "fix: serialize refreshes and bound provider waits"`

### Task 7: Renderer unit correctness and error states

**Files:**
- Modify: `src/renderer/pages/BalanceQuery.tsx`
- Modify: `src/renderer/pages/Dashboard.tsx`
- Modify: `src/renderer/pages/RequestLogs.tsx`
- Modify: `src/renderer/pages/ApiKeys.tsx`
- Modify: `src/renderer/pages/PricingConfig.tsx`
- Test: `tests/unit/api-key-card.test.ts`
- Test: `tests/unit/request-logs-filter.test.ts`
- Create: `tests/unit/renderer-data-format.test.ts`

**Interfaces:**
- Only `currency === 'TOKENS'` may render Token units; cash balances stay currency-specific.
- Per-card refresh must either call a new `usage:refresh-one` IPC or be relabeled as page-level refresh; the implementation must not silently fan out.
- Request log sorting/filtering must be server-side or explicitly scoped to the current page; stale loads must be ignored by request sequence.

- [ ] **Step 1: Write failing unit tests for currency isolation, refresh scope, and stale request sequencing**

Add `cash balances never render as TOKENS`, `manual refresh targets one key`, and `late request cannot overwrite newer filter`. Assert a cash-only snapshot produces no Token fallback, a refresh-one call carries the selected UUID, and a stale Promise result is ignored.

- [ ] **Step 2: Run RED**

Run `npx vitest run tests/unit/api-key-card.test.ts tests/unit/request-logs-filter.test.ts tests/unit/renderer-data-format.test.ts --reporter=verbose`; the current all-key refresh and cash fallback must fail.

- [ ] **Step 3: Implement explicit Renderer data contracts**

Add a typed `usage:refresh-one` IPC that validates a UUID and calls a single-key scheduler path, or remove the card action and make it a page-level refresh. Gate Token labels on `currency === 'TOKENS'`, add request sequence guards to Request Logs, move sort fields to the server query, and add error state plus retry CTA to initial loads.

- [ ] **Step 4: Run GREEN and regression checks**

Run the focused command from Step 2, then `npm run typecheck`, `npm run lint`, `npm run format:check`, and `npm test`.

- [ ] **Step 5: Commit**

`git add src/renderer/pages/BalanceQuery.tsx src/renderer/pages/Dashboard.tsx src/renderer/pages/ApiKeys.tsx src/renderer/pages/RequestLogs.tsx src/renderer/pages/PricingConfig.tsx src/shared/ipc-channels.ts src/shared/ipc-schemas.ts src/preload/index.ts src/main/ipc/register-handlers.ts src/main/scheduler/refresh.ts tests/unit/api-key-card.test.ts tests/unit/request-logs-filter.test.ts tests/unit/renderer-data-format.test.ts && git commit -m "fix: correct renderer units and refresh scope"`

### Task 8: Real Electron E2E coverage

**Files:**
- Modify: `playwright.config.ts`
- Modify: `package.json`
- Create: `tests/e2e/smoke.spec.ts`
- Create: `tests/e2e/fixtures.ts`
- Modify: `tests/README.md`

**Interfaces:**
- Use Playwright `_electron.launch()` against the built Main entry or a controlled dev Electron process; do not call the browser project “electron” while using Desktop Chrome.
- E2E fixtures must use a temporary userData/database and synthetic keys only.

- [ ] **Step 1: Add a failing smoke test**

Create `tests/e2e/smoke.spec.ts` that launches Electron with a temporary `userData` path, asserts `window.api.version === '1.0.1'`, visits API Keys, creates and deletes a synthetic pricing row, and writes/reads `refresh_interval_min` through Settings.

- [ ] **Step 2: Run RED with `npm run test:e2e`**

The current suite must fail because `tests/e2e` is absent or because the Electron fixture is not implemented.

- [ ] **Step 3: Implement Electron fixture and cleanup**

Add `tests/e2e/fixtures.ts` with `_electron.launch({ args: [out/main/index.js], env: { ...process.env, TOKENLUB_TEST_USER_DATA: tempDir } })`; close the app and remove the temporary directory in `afterEach`. Do not use real credentials or network Provider calls.

- [ ] **Step 4: Run GREEN and regression checks**

Run `npm run build`, `npm run test:e2e`, then `npm run typecheck`, `npm test`, and `npm run lint`.

- [ ] **Step 5: Commit**

`git add playwright.config.ts package.json tests/e2e/smoke.spec.ts tests/e2e/fixtures.ts tests/README.md && git commit -m "test: add Electron smoke coverage"`

### Task 9: Dependency upgrade assessment and Windows signing preparation

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `electron.vite.config.ts` when the selected supported upgrade changes the Electron entry configuration
- Modify: `README.md`, `README.zh-CN.md`, `CHANGELOG.md`
- Create: `docs/release/1.0.1-security-and-signing.md`

**Interfaces:**
- Upgrade Electron, Vite, Vitest and electron-builder only in compatible increments, with a fresh audit and full build after each dependency group.
- Never commit a certificate, private key, token, or signing password. Signing configuration must consume environment variables and fail closed when absent.
- Release documentation must state unsigned vs signed artifact status and include SHA-256 generation commands.

- [ ] **Step 1: Record current versions and audit baseline**

Save the current `npm audit --registry=https://registry.npmjs.org --json`, `npm ls electron vite vitest electron-builder`, and `Get-AuthenticodeSignature artifacts/dist/*.exe` results in `docs/release/1.0.1-security-and-signing.md` without copying secrets.

- [ ] **Step 2: Upgrade the Electron runtime group**

Upgrade Electron and rebuild `better-sqlite3`; run `npm run typecheck`, `npm test`, `npm run build`, and a packaged startup smoke check before changing Vite or Vitest.

- [ ] **Step 3: Upgrade the build/test group**

Upgrade Vite, electron-vite, Vitest, and electron-builder together only when their peer ranges agree; regenerate `package-lock.json`, rerun the full checks, and compare the audit report.

- [ ] **Step 4: Add environment-only signing configuration and documentation**

Configure electron-builder to read certificate identity/password from environment variables, never commit certificate material, and document that a missing certificate produces an explicitly unsigned artifact.

- [ ] **Step 5: Verify packaging and sign when credentials are available**

Run `npm run dist:win` after the signing environment is supplied; otherwise run the unpacked build, record the unsigned status, and do not claim signed release readiness.

- [ ] **Step 6: Commit**

`git add package.json package-lock.json electron.vite.config.ts docs/release/1.0.1-security-and-signing.md README.md README.zh-CN.md CHANGELOG.md && git commit -m "chore: harden release toolchain and signing docs"`

## Final verification

After Task 9, run independently (not concurrently):

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
npm run test:e2e
```

Expected: the first five commands exit 0; `npm run test:e2e` exits 0 with real Electron tests. Inspect `git status --short`, the generated artifact metadata, Authenticode signature status, and the final audit report before claiming completion.
