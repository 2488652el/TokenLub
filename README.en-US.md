# TokenLub

**TokenLub is a Windows and macOS desktop dashboard for LLM token usage, API key
balances, model pricing, and local coding-session cost analysis.**

[中文说明](./README.md) · [Architecture](./docs/ARCHITECTURE.md) ·
[Provider Notes](./docs/PROVIDERS.md)

---

## Why TokenLub

TokenLub brings provider balances, request logs, local CLI session usage, and
model pricing into one local Electron app. It is designed for developers who use
multiple LLM providers and want a private, practical view of where tokens and
money are going.

### Highlights

| Area                  | What it does                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Provider balances     | Query balances and token plans across DeepSeek, Zhipu, Moonshot, MiniMax, LongCat, OpenRouter, NewAPI-compatible services, and more. |
| Local session parsing | Read Claude Code and Codex CLI JSONL logs, then roll them up by project, model, provider, and date.                                  |
| Cost accounting       | Estimate spend with high-precision decimal math and configurable per-model pricing.                                                  |
| API key management    | Store API keys locally with Electron `safeStorage`; the renderer never receives raw secrets.                                         |
| Request logs          | Browse, filter, inspect, and export request-level token usage as CSV.                                                                |
| Desktop packaging     | Ships Windows installer/portable builds and separate macOS x64/arm64 DMGs.                                                           |

---

## Latest Release

Current formal build: **TokenLub 1.0.5**

| Artifact     | Path                                         |
| ------------ | -------------------------------------------- |
| Installer    | `artifacts/dist/TokenLub-1.0.5-x64.exe`      |
| Portable app | `artifacts/dist/TokenLub-1.0.5-portable.exe` |
| Unpacked app | `artifacts/dist/win-unpacked/`               |

The app icon is bundled through `build/icon.ico` on Windows, `build/icon.icns`
on macOS, and `build/icon.png` for local development windows.

---

## Quick Start

### Requirements

- Windows 10/11 or macOS 12+
- Node.js 24.x, matching `.nvmrc`
- npm 11+

### Install Dependencies

```bash
npm install
```

On a clean Windows machine, if native dependency installation fails because
Visual Studio Build Tools are missing, use the project helper:

```bash
npm install --ignore-scripts
node scripts/postinstall-better-sqlite3.cjs
```

The helper fetches the Electron-compatible `better-sqlite3` prebuild and is safe
to run more than once.

### Run Locally

```bash
npm run dev
```

### Build and Verify

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

### Package for Windows

```bash
npm run dist:win
```

Outputs are written to `artifacts/dist/`.

### Package for macOS

Run these commands on macOS; each architecture is intentionally packaged as a
separate DMG:

```bash
npm run dist:mac:x64
npm run dist:mac:arm64
```

Signing and notarization credentials must come from the macOS Keychain or the
`CSC_NAME`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
`APPLE_TEAM_ID` environment variables. A build without these credentials is an
unsigned local build, not a formal release.

Before publishing, verify the identity, app signature, Gatekeeper assessment,
notarization staple, and checksum without printing credential values:

```bash
security find-identity -v -p codesigning
codesign --verify --deep --strict --verbose=2 "/path/to/TokenLub.app"
spctl --assess --type execute --verbose=4 "/path/to/TokenLub.app"
xcrun stapler validate "/path/to/TokenLub.app"
shasum -a 256 artifacts/dist/TokenLub-*.dmg
```

---

## Data and Migration

TokenLub stores its SQLite database under Electron `app.getPath('userData')` as:

```text
tokenlub.db
```

For users upgrading from the earlier TokenScope name, the app attempts a
one-time local copy from legacy database locations such as `tokenscope.db` in
the old user-data directories. This preserves historical API keys, usage logs,
pricing, and balance snapshots after the rename.

---

## Security Model

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- IPC payloads are validated on the main-process side
- API keys are encrypted with Electron `safeStorage`
- Local log parsers only read session files; they do not modify or delete them
- Secrets must be supplied through the UI or environment variables, never pasted
  into source code

---

## Project Layout

```text
src/
  main/       Electron main process: SQLite, providers, IPC, schedulers
  preload/    Safe bridge exposed to the renderer
  renderer/   React UI, pages, layout, charts, forms
  shared/     Shared types, IPC contracts, pure utilities
tests/        Vitest unit tests
docs/         Architecture, provider notes, cloud-sync and deployment notes
build/        Electron Builder resources, including app icons
artifacts/    Generated packages and local verification outputs
```

---

## Development Notes

- Keep changes small and reviewable.
- Add tests for behavior changes.
- Do not add telemetry or network calls unless explicitly requested.
- Do not print or commit secrets.
- Use `npm run dist:win` for the canonical Windows release path.
- Build macOS DMGs on macOS and verify signing, notarization, and Gatekeeper
  before calling them release artifacts.

---

## License

MIT
