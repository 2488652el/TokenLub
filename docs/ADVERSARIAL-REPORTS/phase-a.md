# Phase A — Scaffold & Build System

## Goal
Set up the Electron 31 + electron-vite + TypeScript 5.5 + React 18 + Tailwind project skeleton. Verify the three-process bundle builds and all tooling (lint, format, typecheck, test) is wired.

## Exit Criteria
- [x] Scaffold files all created in parallel by 3 sub-agents (configs, src/, tests+resources+docs)
- [x] `tsc --noEmit` clean for both `tsconfig.node.json` and `tsconfig.web.json`
- [x] `electron-vite build` produces all three bundles (main / preload / renderer)
- [x] Preload exposes `window.api.ping()` / `version`
- [ ] `npm run dev` opens the window — deferred (interactive, requires display; CI verification pending)
- [ ] `npm test` runs Vitest — vacuous: 0 tests added in Phase A by design
- [ ] `npm run dist:win` produces an installer — deferred to Phase K
- [ ] ESLint flat config + Prettier — config files written, not run as part of Phase A

## Files added

**Root configs (15 files):**
`package.json`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, `electron.vite.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `eslint.config.js`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `.gitignore`, `.husky/pre-commit`, `vitest.config.ts`, `playwright.config.ts`

**Source (15 files):**
- `src/main/index.ts`, `src/main/window.ts`
- `src/preload/index.ts`
- `src/shared/ipc-channels.ts`, `src/shared/types/{provider,api-key,usage,pricing,alert}.ts`, `src/shared/utils/money.ts`
- `src/renderer/{index.html, main.tsx, App.tsx, styles/tailwind.css, styles/tokens.css}` (App.tsx later replaced by Phase B agent)

**Tests + resources + docs:**
- `tests/README.md`, `resources/README.md`
- `docs/ARCHITECTURE.md`, `docs/PROVIDERS.md`, `docs/PROGRESS.md`
- `docs/ADVERSARIAL-REPORTS/{README.md, phase-a.md}`

## Commands run

| Command | Result |
| --- | --- |
| `npm install` (default, with scripts) | ❌ failed at `better-sqlite3` postinstall — `node-gyp` cannot find Visual Studio (Windows clean box) |
| `npm install --ignore-scripts` | ✅ 841 packages in 17s |
| `npx prebuild-install --runtime=electron --target=31.3.0` (with `npm_config_cache` redirected) | ✅ prebuilt `better_sqlite3.node` downloaded; cross-device-link error bypassed |
| `npx tsc --noEmit -p tsconfig.node.json` | ✅ clean |
| `npx tsc --noEmit -p tsconfig.web.json` | ✅ clean |
| `npx electron-vite build` | ❌ first attempt → `@layer components` error in tokens.css |
| `npx electron-vite build` (after stripping `@layer components` wrapper) | ✅ main 1.68 kB · preload 0.18 kB · renderer index.html 0.89 kB + CSS 28.59 kB + JS 290.78 kB |

## Findings

### 🔴 CRITICAL — `better-sqlite3` native build breaks on clean Windows
**Problem**: `better-sqlite3@11.10.0` postinstall script invokes `node-gyp rebuild`, but Node 24 on a Windows box without Visual Studio Build Tools cannot compile. The default `npm install` exits with a long gyp error log and rolls back node_modules.

**Root cause**: even though `better-sqlite3` ships Electron prebuilt binaries via `prebuild-install`, the npm postinstall path **still** tries gyp first. Additionally, `prebuild-install`'s cache directory rename hit an `EXDEV: cross-device link not permitted` error in the user's npm cache.

**Fix applied**:
1. `npm install --ignore-scripts` (skips both gyp AND the prebuild hook — they're part of postinstall)
2. Manually invoke `prebuild-install` with a redirected `npm_config_cache`:
   ```bash
   cd node_modules/better-sqlite3
   npm_config_cache=C:\Users\bestz\AppData\Local\npm-cache ../.bin/prebuild-install \
     --runtime=electron --target=31.3.0 --arch=x64 --platform=win32
   ```
3. Verified: `build/Release/better_sqlite3.node` present.

**Recurrence prevention** — must do before Phase C (which needs `better-sqlite3`):
- README.md needs a "Windows prerequisites" section spelling out this 3-step ritual
- Consider adding a `postinstall` fallback to `package.json` that tries prebuild first, then gyp:
  ```json
  "postinstall": "node scripts/postinstall-better-sqlite3.cjs"
  ```

### 🟡 MINOR — `postcss.config.js` `MODULE_TYPELESS_PACKAGE_JSON` warning
**Problem**: Vite prints this warning on every build because `postcss.config.js` uses ESM `export default` but `package.json` lacks `"type": "module"`. Adding `"type": "module"` would break `electron-builder` CJS auto-detection of `out/main/index.js`.

**Fix**: rename `postcss.config.js` → `postcss.config.mjs`. **Deferred** (cosmetic, non-blocking).

### 🟢 Design tokens — Tailwind `colors.bg` etc. integration
Verified `tailwind.config.ts` matches the colors extracted from `tokenlub-design.html`:
- accent `#10B981` / hover `#059669` / text `#059669` ✓
- bg.base `#FAFAF8` ✓, sidebar `#FFFFFF` ✓, hover `#F3F4F6` ✓, active `#ECFDF5` ✓
- text.primary `#171717`, secondary `#737373`, muted `#A3A3A3` ✓
- border.light `#E8E8E6`, DEFAULT `#D4D4D2`, focus `#10B981` ✓
- tag-anthropic `#996B38`, tag-openai `#3B82F6`, tag-gemini `#059669`, tag-deepseek `#8B5CF6`, tag-longcat `#B45309` ✓

## Fixes applied

- ✅ Fixed `tokens.css` removing `@layer components { ... }` so that **any** CSS-import order works (settings.css in Phase I, etc. won't hit this again).
- ✅ Got `better-sqlite3` prebuilt binary in place.

## Remaining carry-overs

- README update with Windows prerequisites (Phase A fix #25)
- Phase A postinstall script for `better-sqlite3` (#25)
- `postcss.config.mjs` rename (#25)
- Phase K packaging needs `resources/installerIcon.ico` — not in scope yet.
