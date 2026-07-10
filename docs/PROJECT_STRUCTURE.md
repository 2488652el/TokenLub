# Project Structure

TokenLub follows a three-process Electron layout. Keep source code, tests, docs, and generated artifacts in separate top-level areas.

## Top-level directories

- `src/` — application source.
  - `src/main/` — Electron main process: IPC handlers, SQLite stores, providers, log parsers, scheduler, crypto.
  - `src/preload/` — safe bridge exposed to the renderer.
  - `src/renderer/` — React UI, layout, pages, components, styles.
  - `src/shared/` — shared types, IPC schemas/channels, pure utilities.
- `tests/` — automated tests. Unit tests are grouped by domain under `tests/unit/`.
- `docs/` — architecture, provider notes, progress, review reports, and this structure guide.
- `resources/` — app runtime resources bundled with Electron when needed.
- `build/` — electron-builder static build resources.
- `scripts/` — local maintenance/install scripts.
- `artifacts/` — generated or historical outputs only. This folder is ignored by git.
  - `artifacts/dist/` — future electron-builder output from `npm run pack/dist/dist:win`.
  - `artifacts/legacy-builds/` — old root-level release folders kept for reference.
  - `artifacts/visual-audit/` — Playwright/manual visual verification screenshots.
- `.cache/` — local compiler/cache files. Ignored by git.
- `out/` — electron-vite build output. Ignored by git.
- `node_modules/` — installed dependencies. Ignored by git.

## Top-level files

- `package.json` / `package-lock.json` — npm scripts and locked dependencies.
- `electron.vite.config.ts` — Electron/Vite build config.
- `tsconfig*.json` — TypeScript configs. Incremental build info is written to `.cache/`.
- `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore` — lint and formatting config.
- `tailwind.config.ts`, `postcss.config.mjs` — renderer styling config.
- `playwright.config.ts`, `vitest.config.ts` — test configs.

## Placement rules

- Do not put generated installers, unpacked apps, screenshots, or temporary audit outputs in the project root.
- Put new domain logic in `src/main/<domain>/`, shared pure logic in `src/shared/`, and renderer-only UI in `src/renderer/`.
- Add tests beside the matching domain under `tests/unit/<domain>/`.
- Keep documents in `docs/`; use `docs/ADVERSARIAL-REPORTS/` only for review reports.
