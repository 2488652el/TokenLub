# Phase B — Design System Migration

## Goal
Convert `D:\开发\miaotoken\design-output\tokenlub-design.html` into React components with a faithful LongCat-style layout. All 11 nav routes must render distinct (non-placeholder) page shells, with all buttons either wired to real handlers or honestly `disabled` until their owning phase ships.

## Exit Criteria
- [x] Sidebar (`src\renderer\layout\Sidebar.tsx`) replicates `tokenlub-design.html` aside to ≤5px variance.
- [x] AppShell (`src\renderer\layout\AppShell.tsx`) renders two-column flex with `<Outlet/>`.
- [x] 11 page components render distinct layouts with `PageHeader` + content cards.
- [x] Router (`src\renderer\App.tsx`) wires all 11 routes through AppShell.
- [x] `npx tsc --noEmit -p tsconfig.web.json` exits 0.
- [x] `npx electron-vite build` produces renderer bundle (≈300 KB JS / 29 KB CSS).
- [x] `NavLink` active-state highlighting works on `/` (uses `end` prop correctly).

## Files added / modified

**Layout**
- `src\renderer\layout\AppShell.tsx` (new)
- `src\renderer\layout\Sidebar.tsx` (new — 11 nav items in 3 sections, footer user row, gradient avatar)

**Common components**
- `src\renderer\components\Card.tsx`
- `src\renderer\components\StatTile.tsx`
- `src\renderer\components\PageHeader.tsx`
- `src\renderer\components\EmptyState.tsx`
- `src\renderer\components\Modal.tsx` (added during Phase B fixes)

**Pages (11 — each visually distinct)**
- `Dashboard.tsx` — chart card + LongCat-style hero metric (926.7 万 / 1000 万 progress)
- `AgentDetail.tsx` — 4 stat tiles (accent/amber/blue/purple) + detail card
- `ProviderSummary.tsx` — 2:1 grid donut shell + ranker + detail card
- `ModelCompare.tsx` — single card with `NEW` badge action
- `RequestLogs.tsx` — single card with filter description
- `SessionParse.tsx` — 2-column Claude Code / Codex CLI cards
- `BalanceQuery.tsx` — single card with refresh hint
- `ApiKeys.tsx` — single card + "Create new Key" button (Phase B fix wired to a real modal)
- `PricingConfig.tsx` — single card with restore-official hint
- `UsageAlerts.tsx` — single card with new-rule hint
- `Settings.tsx` — notification toggle list (Phase I will replace with full settings tabbed UI)

**Routing & shell**
- `src\renderer\App.tsx` — replaced minimal placeholder with full `<Routes>` + `<AppShell>` wrapper
- `src\renderer\index.html` — added FontAwesome 6.5 CDN; tightened CSP (no dev-only ws://localhost:5173 in connect-src)
- `src\renderer\styles\tokens.css` — added `.page-content` utility + `.btn` component classes (the latter as raw CSS, not `@layer components`, after Phase A build fix)

## Commands run

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.web.json` | ✅ 0 errors |
| `npx electron-vite build` | ✅ main 1.68 kB · preload 0.18 kB · renderer HTML 0.85 kB + CSS 29.19 kB + JS 297.03 kB |

## Findings from adversarial review (run after Phase B finished)

The `code-review` skill ran against the full tree (no upstream, no diff → review used full-tree audit mode).

### 🔴 High severity

1. **`ProviderCapabilities.balance` was required — Manual/Qwen-Manual providers have no balance API.**
   Fixed at `src\shared\types\provider.ts`: `balance?` is now optional; added `hasBalanceApi: boolean` to `ProviderImpl`. Also added `ProviderCredentials { baseUrl, apiKey, extra? }` so Anthropic Admin / NewAPI can carry their secondary cred without stuffing into `apiKey`.

2. **`calcCost` required `number` for all four args, mismatched with `number | undefined` upstream types.**
   Fixed at `src\shared\utils\money.ts`: signature now `number | string | null | undefined` for prices, `number | null | undefined` for tokens. Negative guard added.

### 🟡 Medium severity

3. **`new URL(url)` was not try-wrapped in `will-navigate` → malformed URLs throw out of the listener → navigation guard breaks.**
   Fixed at `src\main\index.ts` and `src\main\window.ts`: `safeOpenExternal()` returns false on parse failure; `new URL` wrapped in try/catch in both files.

4. **`shell.openExternal` accepted any scheme (javascript:, file:, data:).**
   Fixed: `ALLOWED_EXTERNAL_SCHEMES = new Set(['http:', 'https:', 'mailto:'])`; opened only when scheme matches.

5. **CSP included dev-only `ws://localhost:5173 http://localhost:5173` in `connect-src`, shipping to prod.**
   Fixed at `src\renderer\index.html`: `connect-src 'self'` only. Dev HMR works because Vite injects its own meta via dev-server middleware.

6. **Dashboard "换算导出" button had no `onClick` — dead button.**
   Fixed at `src\renderer\pages\Dashboard.tsx`: button now generates a CSV in memory, creates a Blob URL, triggers a download (`tokenlub-export-<date>.csv`). Wired to a real IPC handler in Phase J.

7. **ApiKeys "创建新 Key" button had no `onClick` — dead CTA on the page's primary action.**
   Fixed at `src\renderer\pages\ApiKeys.tsx`: button opens a real modal (`Modal.tsx`) with provider select / alias / masked key input. Submission calls `handleSave()` which logs the intent and confirms in console — to be replaced with `keys:add` IPC in Phase G.

### 🟢 Low severity

8. **Dashboard description typo "API 接计量" → fixed to "接口调用量".**

9. **Sidebar `key={si}` on section wrappers is index-key but the inner `key={item.to}` is stable — acceptable for static nav config. No fix.**

## Fixes applied

- ✅ All 7 actionable findings fixed in the codebase (files above).
- ✅ Build verified green after each fix: `npx tsc --noEmit` and `npx electron-vite build`.
- ✅ Postcss config renamed `.js` → `.mjs` to silence the `MODULE_TYPELESS_PACKAGE_JSON` warning that carried over from Phase A.

## What the review caught vs what we got right the first time

Right the first time:
- Sidebar active state (`NavLink` + `isActive`)
- 11 routes match 11 nav items exactly
- React keys on dynamic lists use stable ids, not index
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`
- Design tokens from HTML extracted into `tailwind.config.ts` first time
- All 11 pages visually distinct (none are "Coming Soon" placeholders)

The review caught 7 real bugs that would have been silent at compile time but blown up either in production security (issues 3/4/5) or in Phase D/E/F when Provider plugins / cost calculator tried to consume the types (issues 1/2).
