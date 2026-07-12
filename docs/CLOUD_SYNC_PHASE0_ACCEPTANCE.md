# TokenLub Cloud Sync Phase 0 Acceptance

> Date: 2026-07-12
> Branch: `codex/cloud-sync-phase0`
> Scope: local sync identity, durable outbox, local status IPC, and remote-apply echo protection.

## 1. Decision

Phase 0 is accepted for the local client foundation.

This phase does not implement cloud authentication, server APIs, push/pull transport, WebSocket/SSE notifications, conflict UI, or the FNS-style web console. It makes the existing Electron client ready for Phase 1 by giving local data stable sync identity, durable pending operations, status visibility, and a safe path for applying future remote changes without producing echo writes.

Go / No-Go:

- Go: proceed to Phase 1 service/auth/device/setting-sync implementation.
- No-Go: do not expose a user-facing cloud sync login or real remote synchronization yet.

## 2. Implemented Scope

| Plan item | Status | Evidence |
| --- | --- | --- |
| React 19 foundation | Done | `package.json`, `package-lock.json`, `src/renderer/pages/ProviderSummary.tsx` |
| native SQLite install fallback | Done | `scripts/postinstall-better-sqlite3.cjs`, `tests/unit/postinstall-better-sqlite3.test.ts` |
| SQLite v6 sync tables | Done | `src/main/store/db.ts`, `tests/unit/store/db-migration.test.ts` |
| stable entity identity for settings/pricing/balance snapshots | Done | `sync_entity_map` backfill and write-path mapping |
| durable local outbox for syncable local changes | Done | `sync_outbox`, settings outbox, user pricing outbox |
| balance snapshot UUID mapping without upload | Done | `src/main/store/balance-repo.ts`, `tests/unit/store/balance-sync-map.test.ts` |
| local sync repository | Done | `src/main/store/sync-repo.ts`, `tests/unit/store/sync-repo.test.ts` |
| local sync status IPC | Done | `sync:get-status`, `window.api.sync.getStatus()` |
| remote apply without echo outbox | Done | `applyRemoteSettingChange`, `applyRemotePricingChange` |

## 3. Data Safety Boundaries

Confirmed in this phase:

- `api_keys.encrypted_key`, `extra_credentials`, access tokens, refresh tokens, and raw secrets are not part of sync payloads.
- `balance_snapshots.raw_json` is not queued for upload.
- `balance_snapshot` records receive stable sync IDs, but Phase 0 does not create balance upload outbox rows.
- `last_refresh_at` remains local and does not produce a sync operation.
- catalog pricing remains local and does not produce a sync operation.
- renderer can only read sync status through preload; it still cannot access SQLite, Node, raw IPC, or filesystem APIs.

## 4. Acceptance Checklist

- [x] Existing database upgrades to schema version 6.
- [x] v6 creates `sync_outbox`, `sync_entity_map`, `sync_state`, `sync_conflicts`, and `idx_sync_outbox_due`.
- [x] v6 backfills existing `refresh_interval_min`, user pricing rows, and balance snapshot rows into `sync_entity_map`.
- [x] v6 backfill is idempotent and also repairs databases already stamped as version 6.
- [x] Local setting update writes business data and `sync_outbox` in one SQLite transaction.
- [x] Local `last_refresh_at` update stays local and does not write `sync_outbox`.
- [x] Local user pricing update writes business data and `sync_outbox` in one SQLite transaction.
- [x] Catalog pricing update does not write `sync_outbox`.
- [x] New balance snapshot writes a stable `balance_snapshot` mapping but does not write `sync_outbox`.
- [x] `listPendingOutbox()` returns only due operations in creation order.
- [x] `acknowledgeOutboxOperations()` removes only acknowledged operation IDs.
- [x] `saveSyncState()` and `getSyncState()` persist and read the local cursor state.
- [x] `getLocalSyncStatus()` exposes pending count, conflict count, bootstrap flag, last success, and last error without exposing raw cursor.
- [x] `sync:get-status` is registered in main process.
- [x] `window.api.sync.getStatus()` is exposed through preload.
- [x] Remote setting apply updates `app_settings` and `sync_entity_map` without writing `sync_outbox`.
- [x] Reapplying the same remote setting remains stable and does not echo.
- [x] Remote pricing apply updates `pricing_entries` and `sync_entity_map` without writing `sync_outbox`.

## 5. Verification Record

Latest verification commands run from `D:\开发\tokengirl\.worktrees\cloud-sync-phase0`:

```powershell
npm test
npm run lint
npm run typecheck
npm run build
```

Latest results:

- `npm test`: 52 test files, 319 tests passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.

Known build warning:

- Vite reports that `src/main/store/pricing-repo.ts` is both dynamically and statically imported, so the dynamic import will not move that module into another chunk. This warning predates the Phase 0 sync work and does not fail the build.

## 6. Phase 0 Commit Ledger

| Commit | Summary |
| --- | --- |
| `14beb5d` | add local sync outbox foundation |
| `0893c60` | queue user pricing changes for sync |
| `2cdb9e7` | add local sync outbox repository |
| `0437690` | backfill sync ids for balance snapshots |
| `d1a846d` | expose local sync status ipc |
| `76c6225` | apply remote sync changes without echo |

Support commits:

| Commit | Summary |
| --- | --- |
| `641ba5c` | ignore local worktrees |

## 7. Residual Gaps Before Phase 1

Phase 1 must still implement:

- protocol v1 schemas as server/client contract files, not only the product plan;
- cloud server project, PostgreSQL migrations, auth, refresh sessions, and device registration;
- `/v1/sync/push`, `/v1/sync/pull`, `/v1/sync/ack`, and initial bootstrap contract;
- client sync scheduler with single-flight execution, retry/backoff, and request idempotency;
- settings-only end-to-end convergence between two user data directories;
- server-side idempotency table and sequence generation;
- client-side page application where remote changes and cursor persistence happen in one SQLite transaction.

Explicitly out of Phase 0:

- syncing API keys or encrypted secrets;
- uploading request logs, raw provider responses, or `balance_snapshots.raw_json`;
- Web console, admin console, Docker deployment, WebSocket/SSE notifications;
- conflict resolution UI and production rollout.

## 8. Rollback Notes

Phase 0 adds SQLite schema version 6. There is no downgrade migration.

Safe rollback strategy during internal testing:

1. Stop the Electron app.
2. Restore the pre-v6 `tokenlub.db` backup plus `-wal` and `-shm` sidecars if present.
3. Return to a build before `14beb5d`.
4. Restart the app and verify existing local pages load.

Do not use production user data for Phase 0 rollback rehearsal.

## 9. Phase 1 Entry Criteria

Start Phase 1 only when all of the following remain true:

- the current branch still passes `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build`;
- no sync payload contains secrets, `raw_json`, or full cursor values in renderer-visible APIs;
- server work starts with tests for auth/device isolation, operation idempotency, cursor advancement, and setting convergence;
- the first real synchronized entity is limited to `setting`, preferably `refresh_interval_min`.
