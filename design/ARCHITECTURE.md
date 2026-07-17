# Architecture

## Three-process Electron model

```
┌─────────────────────────────────────────────────────────────┐
│  MAIN (Node.js, privileged)                                 │
│    • BrowserWindow lifecycle, single window                 │
│    • SQLite open + migrations (better-sqlite3)              │
│    • Provider HTTP calls (DeepSeek, Zhipu, Anthropic...)    │
│    • API Key encryption via safeStorage                     │
│    • Local log discovery + incremental parse                │
│    • Refresh scheduler + alert event checks                 │
└──────────────────┬──────────────────────────────────────────┘
                   │ IPC (typed channels in code/src/shared/ipc-channels.ts)
┌──────────────────▼──────────────────────────────────────────┐
│  PRELOAD (sandboxed context)                                │
│    • contextBridge.exposeInMainWorld('api', { ... })        │
│    • Whitelisted function surface (Zod-validated payloads)  │
└──────────────────┬──────────────────────────────────────────┘
                   │ window.api.*
┌──────────────────▼──────────────────────────────────────────┐
│  RENDERER (React 18, sandboxed)                              │
│    • Pure UI: pages, charts, forms, tables                  │
│    • React pages cache fetched data in local component state│
│    • Recharts renders dashboards                            │
│    • Tailwind for LongCat-inspired tokens                   │
└─────────────────────────────────────────────────────────────┘
```

## IPC channels

All names centralized in `code/src/shared/ipc-channels.ts` as `IPC.*`. Naming: `domain:verb` for request/reply; `subscribe:topic` for event push.

## Storage

- `better-sqlite3` database under `app.getPath('userData')`; migrations are implemented inline in `code/src/main/store/db.ts`.
- `app_settings` table for non-secret settings such as refresh interval.

## Provider plugin model

Every provider implements `ProviderImpl` from `code/src/shared/types/provider.ts`. New provider = drop a file under `code/src/main/providers/<id>/index.ts` and add to `registry.ts`.

Categories:
- `token-plan` — prepaid plan balance (Zhipu, MiniMax, Moonshot...)
- `third-party` — third-party aggregator balance (DeepSeek, SiliconFlow...)
- `admin-org` — org-level cost API (Anthropic Admin, OpenAI Admin)
- `newapi-generic` — generic NewAPI/OneAPI user/self endpoint
- `manual` — fallback for providers with no API (user enters balance)

## Local log parsers (Phase D2)

- Claude Code: `%USERPROFILE%\.claude\projects\<encoded-cwd>\{*.jsonl, **/subagents/**/*.jsonl}`
- Codex CLI: `%USERPROFILE%\.codex\sessions\YYYY\MM\DD\*.jsonl`

Stream-parse, dedupe by `message_id` (Codex falls back to `session_id:line_no`), store to same `usage_records` table with `source='session-log'`.

## Security

- IPC payloads validated by Zod on main side
- Renderer cannot access Node, fs, or raw `ipcRenderer`
- Log file reads are read-only
- API keys never reach renderer — only `keyTail` (last 4 chars) shown
- Decryption only happens inside main, on demand
