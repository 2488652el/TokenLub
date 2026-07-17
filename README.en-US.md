# TokenLub

**TokenLub is a Windows and macOS desktop dashboard for LLM token usage, API key
balances, model pricing, and local coding-session cost analysis.**

[中文说明](./README.md) · [Architecture](./design/ARCHITECTURE.md) ·
[Provider Notes](./design/PROVIDERS.md)

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
| Local session parsing | Parse Claude Code and Codex CLI JSONL logs on demand; background parsing follows the toggle and page open never triggers it.              |
| Cost accounting       | Estimate spend with high-precision decimal math and configurable per-model pricing.                                                  |
| API key management    | Store API keys locally with Electron `safeStorage`; the renderer never receives raw secrets.                                         |
| Request logs          | Browse, filter, inspect, and export request-level token usage as CSV.                                                                |
| Desktop packaging     | Ships Windows installer/portable builds and separate macOS x64/arm64 DMGs.                                                           |

---

## Latest Release

Current formal build: **TokenLub 1.0.6**

This release fixes local CLI session parsing triggers: automatic parsing runs
only while its toggle is enabled, opening API Keys does not parse, and manual
parsing is limited to the **Parse all** and per-source **Parse into database**
buttons.

| Artifact     | Path                                                               |
| ------------ | ------------------------------------------------------------------ |
| Installer    | `demo/tokenlub-1.0.6-<change>-<model>/TokenLub-1.0.6-x64.exe`      |
| Portable app | `demo/tokenlub-1.0.6-<change>-<model>/TokenLub-1.0.6-portable.exe` |
| Unpacked app | `demo/tokenlub-1.0.6-<change>-<model>/win-unpacked/`               |

### Windows downloads

- [TokenLub-1.0.6-x64.exe installer](https://github.com/2488652el/TokenLub/releases/download/v1.0.6/TokenLub-1.0.6-x64.exe)
- [TokenLub-1.0.6-portable.exe](https://github.com/2488652el/TokenLub/releases/download/v1.0.6/TokenLub-1.0.6-portable.exe)
- [GitHub Release v1.0.6](https://github.com/2488652el/TokenLub/releases/tag/v1.0.6)

The app icon is bundled through `design/assets/icon.ico` on Windows,
`design/assets/icon.icns` on macOS, and `design/assets/icon.png` for local
development windows.

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
node code/scripts/postinstall-better-sqlite3.cjs
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

```powershell
npm run dist:win -- --change "project-classification" --model "GPT-5"
```

Outputs are written to `demo/tokenlub-<version>-<change>-<model>/`. Both
`--change` and `--model` are required; the version comes from `package.json`.

### GitHub version synchronization

Every latest-version package must compare the local `package.json` version with
the default-branch `package.json`, the latest GitHub Release/Tag, and the
versioned download links in both README files. A failed GitHub lookup is an
unknown result, not a match.

When a version differs, update both README files, run `npm run github:prepare`
and `npm run github:audit`, review `github/repository/`, and publish source only
from that staging directory. Update the Git tag, GitHub Release, and release
assets afterward; generated installers must not be committed to the Git
repository. Do not repeat an upload when every version already matches.

### Package for macOS

Run these commands on macOS; each architecture is intentionally packaged as a
separate DMG:

```bash
npm run dist:mac:x64 -- --change "release-change" --model "GPT-5"
npm run dist:mac:arm64 -- --change "release-change" --model "GPT-5"
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
shasum -a 256 demo/tokenlub-<version>-<change>-<model>/TokenLub-*.dmg
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
skill/          Project-specific skills, each with its own SKILL.md
code/           Desktop frontend, Electron backend, shared code, and build helpers
drive/          Cloud-sync server, Docker definitions, deployment docs, and operations
plan/           Timestamped plans and decision records
design/         Architecture, provider notes, screenshots, and application assets
demo/           Unit/E2E/integration tests, temporary scripts, and generated builds
github/         GitHub staging, allowlist, and sensitive-content audit tooling
```

---

## Development Notes

- Keep changes small and reviewable.
- Add tests for behavior changes.
- Do not add telemetry or network calls unless explicitly requested.
- Do not print or commit secrets.
- Use `npm run dist:win -- --change "..." --model "..."` for the canonical Windows release path.
- Build macOS DMGs on macOS and verify signing, notarization, and Gatekeeper
  before calling them release artifacts.

---

## License

MIT
