# Phase D2 — Local Log Parsers

## Goal
Parse local Claude Code + Codex CLI session JSONL logs into `usage_records`, and detect existing CLI-installed API keys for one-click import — so users see real usage data without needing vendor balance APIs. This is the "本地日志聚合" data source from the original plan.

## Approach: 3 parallel agents + main-process integration

Three independent agents ran concurrently, each writing a pure-function module with zero file overlap:
- **Agent A** — `claude.ts`: Claude Code JSONL parser + discovery + incremental sync
- **Agent B** — `codex.ts`: Codex CLI JSONL parser (cumulative→delta conversion) + discovery + sync
- **Agent C** — `cli-auth.ts`: CLI key detector with `maskKey` security helper

Main process then integrated: `sync.ts` orchestration + `register-handlers.ts` IPC wiring + `preload` `importFromCLI` exposure.

## Exit criteria
- [x] Claude Code JSONL parser (`parseClaudeSessionLine`, `parseClaudeSessionFile`, `discoverClaudeSessions`, `syncClaudeFile`) — 13 tests
- [x] Codex CLI JSONL parser with cumulative→delta math (`parseCodexSessionFile`, `discoverCodexSessions`, `syncCodexFile`) — 12 tests
- [x] CLI auth detector (`detectClaudeKey`, `detectCodexKey`, `maskKey`, `detectAllCLIKeys`) — 14 tests
- [x] Sync orchestration (`syncClaudeSessions`, `syncCodexSessions`, `syncAllSessions`, `discoverAllSessions`) with `log_sync_state` incremental tracking
- [x] IPC handlers wired (5 stubs replaced + `keys:import-from-cli` added)
- [x] Preload exposes `keys.importFromCLI`
- [x] Adversarial review complete — 9 findings, 4 high-severity fixed, 5 low-severity accepted with rationale

## Files created (8) + modified (2)

**NEW:**
- `src/main/log-parsers/claude.ts` — Claude Code parser
- `src/main/log-parsers/codex.ts` — Codex CLI parser (cumulative→delta)
- `src/main/log-parsers/cli-auth.ts` — CLI key detector + `maskKey`
- `src/main/log-parsers/sync.ts` — orchestration + `log_sync_state` read/write
- `tests/unit/log-parsers/claude.test.ts` (13 tests)
- `tests/unit/log-parsers/codex.test.ts` (12 tests)
- `tests/unit/log-parsers/cli-auth.test.ts` (14 tests)

**MODIFIED:**
- `src/main/ipc/register-handlers.ts` — 5 stub log handlers → real; + `keys:import-from-cli`
- `src/preload/index.ts` — `keys.importFromCLI` + `openFolder`/`onSyncDone` return types widened with `error?`

## Commands run

| Command | Result |
| --- | --- |
| `tsc --noEmit -p tsconfig.node.json` | ✅ clean |
| `tsc --noEmit -p tsconfig.web.json` | ✅ clean |
| `vitest run` | ✅ 17 files / 80 tests passed (39 new D2 tests + 41 prior, no regressions) |
| `eslint .` | ✅ 0 errors / 0 warnings |
| `electron-vite build` | ✅ main + preload + renderer |
| `electron-vite dev` (10s smoke) | ✅ dev server :5174 + electron app started |

## Adversarial review — 9 findings

### 🔴 High severity (4 — ALL FIXED)

1. **`shell.openPath` arbitrary execution** (`register-handlers.ts` logOpenFolder) — `shell.openPath` EXECUTES `.exe`/`.bat`/`.cmd` on Windows. A file path (vs directory) would launch an arbitrary executable. **Fix**: added `statSync` directory validation; non-directory paths return `{ ok: false, error }` without calling `openPath`.

2. **Codex `seq-N` messageId cross-file collision** (`codex.ts:105`) — `messageId = seq-${sequence}` collided on the `UNIQUE(source, message_id)` dedup constraint across different session files (both have `seq-1`, `seq-2`, …). Second file's records silently dropped. **Fix**: messageId now prefixed with sessionId: `${sessionId}-seq-${sequence}`. Test updated.

3. **Claude `syncClaudeFile` UTF-8 byte-boundary corruption** (`claude.ts:159`) — `readFileSync(..., {encoding:'utf8'}).slice(byteOffset)` sliced by UTF-16 code-unit index, but `byteOffset` is a byte count. For logs with multi-byte UTF-8 (Chinese user messages), the slice could start mid-character, producing invalid JSON that silently dropped records. **Fix**: read as Buffer, `buf.subarray(byteOffset).toString('utf8')` — byte-accurate slicing; worst case a single boundary line fails `JSON.parse` and is skipped, never the whole file.

4. **`logSync` partial-failure left progress UI hanging** (`register-handlers.ts`) — if `syncAllSessions` threw (DB locked, disk error), the `logSyncDone` event was never sent and the renderer's progress UI hung forever. **Fix**: wrapped in `try/catch`; on failure, emits a `logSyncDone` with `error` field and zeroed totals so the UI can recover and show the error.

### 🟡 Medium severity (1 — ACCEPTED with rationale)

5. **Codex cumulative-reset double-count** (`codex.ts:110`) — when cumulative totals decrease mid-file (a reset — new session context in the same file, or a counter bug), `prev` is set to the lower cumulative, so a subsequent event's delta could re-count tokens already attributed before the reset. **Accepted**: a reset is indistinguishable from a new-session-context at the parser level, and treating it as a new baseline is the correct semantic for "new session." Documented in code comment. Real over-count requires a counter bug (not a session switch), which is outside our control.

### 🟢 Low severity (4 — ACCEPTED)

6. **Large credential-file JSON.parse DoS** (`cli-auth.ts`) — `JSON.parse` of a multi-GB `~/.claude/.credentials.json` could blow memory. **Accepted**: these files are local, user-owned, and typically <1KB. A malicious local process replacing the file has far more direct attack vectors. Not worth a size guard.

7. **Symlink loop in discovery** (`claude.ts`/`codex.ts` `discoverXxxSessions`) — `statSync` follows symlinks; a symlink loop would infinite-loop the walk. **Accepted**: the default roots (`~/.claude/projects`, `~/.codex/sessions`) are created by the CLIs and contain no symlinks. Future hardening: add a `realpath` set + depth limit if user-configurable roots are added.

8. **`mtimeMs` exact-float comparison** (`sync.ts`) — `st.mtimeMs === mtimeMs` could theoretically match for two writes in the same 100ns window. **Accepted**: the `st.size === byteOffset` guard is the actual correctness check — any real append changes size, so the fast-path can't skip new data even if mtime collides.

9. **Codex re-parses whole file each sync** (`syncCodexFile`) — O(n) per sync because deltas need full-session context. **Accepted**: dedup via `INSERT OR IGNORE` makes it idempotent; Codex session files rarely exceed a few thousand events. The fast-path (`mtime + size unchanged`) skips re-parse for unchanged files anyway.

## Security contract enforced

- `detectClaudeKey()` / `detectCodexKey()` return `fullKey` (raw key) for **main-process import use only**.
- IPC handlers `logDetectClaudeKey` / `logDetectCodexKey` return ONLY `{ found, maskedKey, path }` — `fullKey` is stripped before crossing to the renderer.
- `keys:import-from-cli` handler calls `detect*Key()` in-process and passes `fullKey` directly to `addKey()` → `encryptSecret()` → the key is encrypted at rest via `safeStorage` and never appears in renderer memory.
- `maskKey` keeps first 8 + last 4 chars; `****` for keys ≤12 chars.
- Tests override `HOME` + `USERPROFILE` to temp dirs so the developer's real credentials are never read during test runs (Windows-specific fix: the spec's `process.env = {...}` reassignment broke `os.homedir()` by replacing Node's libuv env proxy with a plain object — CLI-auth agent caught and fixed this empirically).

## ProviderId mapping for imported CLI keys

- Claude Code key (`sk-ant-api03-...`) → `providerId: 'anthropic-admin'`, alias "Claude Code (imported)"
- Codex CLI key (`sk-...`) → `providerId: 'openai-admin'`, alias "Codex CLI (imported)"

Note: these are regular API keys, not admin keys, so the admin-org balance/usage endpoints may return 401/403. The import's primary value is (a) the key is encrypted-at-rest and recorded, (b) future session-log parsing can correlate usage to it. Users can adjust providerId later if a non-admin balance provider is added.

## Test coverage

- 80 tests total (39 new in D2 + 41 prior, no regressions)
- Claude parser: 13 tests (line parse, file parse, discovery walk, incremental sync, edge cases)
- Codex parser: 12 tests (delta math, inclusive-cache subtraction, reset clamping, cross-file messageId, fallbacks)
- CLI auth: 14 tests (masking, env-var detection, file detection, fallback paths, malformed JSON, negative cases)

## Carry-overs to Phase G (UI)

- **"Import from CLI" button** in the API Keys page — calls `window.api.keys.importFromCLI('claude' | 'codex')`, shows success/failure toast, refreshes the key list.
- **Session Parse page** (`pages/SessionParse.tsx` — already scaffolded in Phase B) — wire to `log.discover()`, `log.sync()`, `log.onSyncProgress` / `log.onSyncDone` for a live sync UI with progress bar + totals.
- **"Detect existing key" hint** in the Add-Key modal — calls `log.detectClaudeKey()` / `log.detectCodexKey()`, shows the masked key + path, offers a one-click import.
