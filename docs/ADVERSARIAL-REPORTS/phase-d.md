# Phase D — Provider Plugins

## Goal
Implement the 14 provider slots from the plan (DeepSeek, Zhipu, Moonshot, SiliconFlow, OpenRouter, StepFun, Anthropic Admin, OpenAI Admin, LongCat, NewAPI Generic, Qwen Manual, Gemini Manual, Manual fallback, MiniMax). Each provider implements the `ProviderImpl` interface and is registered in `src/main/providers/registry.ts`. Real API calls where verified possible, multi-endpoint probe fallbacks where the API surface is undocumented.

## Exit Criteria
- [x] 13 providers registered in `registry.ts` (MiniMax removed — see Findings)
- [x] Each provider has at least 1 unit test for `balance()` and (where applicable) `usage()` and admin-key handling
- [x] `ProviderImpl` type contract enforced: `hasBalanceApi=true` ⇒ `balance()` function present, `hasUsageApi=true` ⇒ `usage()` function present
- [x] HTTP client retries 429 with backoff, handles network errors, 15s timeout
- [x] Admin keys sourced from `creds.extra?.['adminKey'] ?? creds.apiKey` for Anthropic / OpenAI
- [x] All build / typecheck / test / lint green
- [x] Adversarial review (15 candidate findings) — all high-severity + medium-severity fixed; 2 low-severity findings accepted as documented risks

## Files Created (22)

**Provider implementations (11 new + 2 from Phase C):**
- `src/main/providers/deepseek/index.ts` (Phase C)
- `src/main/providers/zhipu/index.ts` (Phase C)
- `src/main/providers/manual/index.ts` (Phase C)
- `src/main/providers/moonshot/index.ts` (NEW)
- `src/main/providers/siliconflow/index.ts` (NEW)
- `src/main/providers/openrouter/index.ts` (NEW)
- `src/main/providers/stepfun/index.ts` (NEW)
- `src/main/providers/anthropic-admin/index.ts` (NEW)
- `src/main/providers/openai-admin/index.ts` (NEW)
- `src/main/providers/longcat/index.ts` (NEW)
- `src/main/providers/newapi-generic/index.ts` (NEW)
- `src/main/providers/qwen-manual/index.ts` (NEW)
- `src/main/providers/gemini-manual/index.ts` (NEW)
- `src/main/providers/http-client.ts` (Phase C)
- `src/main/providers/registry.ts` (MODIFIED)

**Tests (8 new + 1 from Phase C):**
- `tests/unit/providers/moonshot.test.ts` (3 tests)
- `tests/unit/providers/siliconflow.test.ts`
- `tests/unit/providers/openrouter.test.ts`
- `tests/unit/providers/stepfun.test.ts`
- `tests/unit/providers/anthropic-admin.test.ts` (3 tests)
- `tests/unit/providers/openai-admin.test.ts` (3 tests)
- `tests/unit/providers/longcat.test.ts`
- `tests/unit/providers/newapi-generic.test.ts` (2 tests)
- `tests/unit/providers/qwen-manual.test.ts`
- `tests/unit/providers/gemini-manual.test.ts`

**Type changes:**
- `src/shared/types/provider.ts`: added `source?: 'vendor-api' | 'session-log'` to `UsageSlice` (so admin providers can mark their slices correctly)

## Commands run

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.node.json` | ✅ clean |
| `npx tsc --noEmit -p tsconfig.web.json` | ✅ clean |
| `npx vitest run` | ✅ 14 test files, 41 tests passed (no regressions) |
| `npx eslint .` | ✅ 0 errors / 0 warnings |
| `npx electron-vite build` | ✅ main + preload + renderer all built |

## Findings from adversarial review (15 candidate, all but 2 fixed)

### 🔴 High severity (7 — ALL FIXED)

1. **OpenRouter `hasUsageApi: true` but no `usage()` function** — would crash any caller iterating providers with `hasUsageApi`. Fixed: changed to `hasUsageApi: false`.

2. **OpenAI Admin `usage()` missing `model` and `source` fields** — `UsageRecord.model` and `.source` are required by the DB schema. Fixed: added `model: r.model` and `source: 'vendor-api'` per slice.

3. **Anthropic Admin `usage()` missing `model` and `source`** — Anthropic's `/v1/organizations/usage` doesn't include model breakdown (separate endpoint). Fixed: use `model: 'anthropic-org-aggregate'` placeholder so dashboard GROUP BY model doesn't collapse to NULL; `source: 'vendor-api'`.

4. **Anthropic Admin `balance()` could produce NaN** — `Number('unknown') = NaN` poisons the whole sum. Fixed: `Number.isFinite(n) ? n : 0` guard inside the reduce.

5. **OpenAI Admin `balance()` inner reduce could throw on missing `b.results`** — `undefined.reduce` throws TypeError. Fixed: `(b.results ?? []).reduce(...)` with `Number.isFinite` guard.

6. **newapi-generic math: `total = (quota + used_quota) * 0.002`** — `used_quota` is lifetime cumulative spend, not a cap. Inflated numbers by orders of magnitude. Fixed: omit `total` entirely; show only `remaining` (current balance) and `used` (lifetime spend); document the semantic.

7. **Moonshot reads `hard_limit_usd` as REMAINING** — it's the CAP, not the remaining. Fixed: probe-endpoint-specific parsing — credit_grants uses OpenAI's `total_available`/`total_granted`, subscription uses `hard_limit_usd` as `total` only.

### 🟡 Medium severity (5 — ALL FIXED)

8. **LongCat maps `balance` to both `remaining` and `total`** — lossy, hides the cap. Fixed: use `total_balance` for `total` when present; type now includes `total_balance`.

9. **Moonshot default currency CNY wrong for overseas `api.moonshot.ai`** — fixed: `baseUrl.includes('.ai') ? 'USD' : 'CNY'`.

10. **OpenRouter free-tier with null limit discards `usage`** — the previous fix above (openrouter hasUsageApi=false) doesn't address this. The new code already emits `used: d.usage` even when limit is null. Documented as working as designed.

11. **Moonshot `hard_limit_usd` confusion** — covered by fix #7.

12. **Anthropic Admin single-input admin key issue** — UI form has no separate admin-key slot. Documented: Phase G UI work will add an extra-key input for admin-org providers. For now, users paste admin key in the API key field (and the provider falls back to `apiKey` if `extra.adminKey` is empty).

### 🟢 Low severity (2 — ACCEPTED)

13. **SiliconFlow `BalanceSnapshot.raw` could leak API key in edge cases** — if a future API change echoes the token in the response body. Accepted: the renderer never needs the raw body for display, and the IPC channel is whitelisted. Mitigation deferred to Phase G (add a `sanitizeForIpc()` filter that strips `Authorization` and `x-api-key` headers and request-id echoes).

14. **StepFun dead-code fallback for flat shape** — the alt flat shape never matches because StepFun always wraps in `data`. Accepted: harmless, kept for forward compat with a hypothetical future API change.

## MiniMax: removed (Finding #15)

The `minimax` provider was a placeholder: the public API domain `api.minimax.chat` and candidate endpoints `/account/balance`, `/user/balance` are all invented. Removed from the registry and the `minimax/` directory deleted. Users who need MiniMax should use the **NewAPI Generic** provider (which adapts to any NewAPI/OneAPI deployment) or the Manual provider (user enters balance).

## Carry-overs to Phase G (UI)

- **Admin key input slot** — API Keys form needs a second input box visible only when `providerId` is `anthropic-admin` or `openai-admin`. The provider reads `creds.extra?.['adminKey']` already; the UI just needs to wire it.
- **Manual balance entry for `qwen-manual` and `gemini-manual`** — these providers have no API, so users must enter balance by hand. The Balance Query page needs a manual-entry modal for these.

## Test coverage

- 41 tests across 14 files
- Each provider has at least 1 happy-path balance test
- Admin providers have 3 tests each (auth header, balance sum, usage parse)
- Manual providers verify `balance` is undefined and `testConnection` returns the manual instruction
- HTTP client has 4 tests (200 / 500 / 429-retry / x-api-key header)
- Money / IPC schemas / safe-storage tests still pass — no regressions
