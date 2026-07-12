/** 本地同步仓库测试:覆盖到期 outbox、确认删除与 cursor 状态持久化。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface OutboxRow {
  operation_id: string
  entity_type: string
  entity_id: string
  base_version: number
  operation: 'upsert' | 'delete'
  payload: string | null
  created_at: string
  attempt_count: number
  next_attempt_at: string | null
  last_error_code: string | null
}

const state = vi.hoisted(() => ({
  outbox: [] as OutboxRow[],
  openConflicts: 0,
  syncStates: new Map<
    string,
    {
      scope: string
      cursor: string | null
      last_success_at: string | null
      last_error_code: string | null
      bootstrap_required: number
    }
  >()
}))

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      return {
        all: (now: string, limit: number) => {
          if (!sql.includes('FROM sync_outbox')) return []
          return state.outbox
            .filter((row) => row.next_attempt_at === null || row.next_attempt_at <= now)
            .sort((a, b) => a.created_at.localeCompare(b.created_at))
            .slice(0, limit)
        },
        get: (scope?: string) => {
          if (sql.includes('COUNT(*) AS count FROM sync_outbox')) {
            return { count: state.outbox.length }
          }
          if (sql.includes('COUNT(*) AS count FROM sync_conflicts')) {
            return { count: state.openConflicts }
          }
          if (!sql.includes('FROM sync_state')) return undefined
          return state.syncStates.get(scope ?? 'default')
        },
        run: (...args: unknown[]) => {
          if (sql.includes('DELETE FROM sync_outbox')) {
            const ids = new Set(args.map(String))
            state.outbox = state.outbox.filter((row) => !ids.has(row.operation_id))
          }
          if (sql.includes('UPDATE sync_outbox')) {
            const [attemptCount, nextAttemptAt, lastErrorCode, operationId] = args
            const row = state.outbox.find((item) => item.operation_id === operationId)
            if (row) {
              row.attempt_count = Number(attemptCount)
              row.next_attempt_at = nextAttemptAt as string | null
              row.last_error_code = lastErrorCode as string | null
            }
          }
          if (sql.includes('INSERT INTO sync_state')) {
            const [scope, cursor, lastSuccessAt, lastErrorCode, bootstrapRequired] = args
            state.syncStates.set(String(scope), {
              scope: String(scope),
              cursor: cursor as string | null,
              last_success_at: lastSuccessAt as string | null,
              last_error_code: lastErrorCode as string | null,
              bootstrap_required: Number(bootstrapRequired)
            })
          }
          return { changes: 1 }
        }
      }
    }
  })
}))

describe('sync repository', () => {
  beforeEach(() => {
    vi.resetModules()
    state.outbox = [
      {
        operation_id: 'due',
        entity_type: 'setting',
        entity_id: 'setting-id',
        base_version: 0,
        operation: 'upsert',
        payload: '{"key":"refresh_interval_min","value":15}',
        created_at: '2026-07-12T00:00:00.000Z',
        attempt_count: 0,
        next_attempt_at: null,
        last_error_code: null
      },
      {
        operation_id: 'future',
        entity_type: 'setting',
        entity_id: 'setting-id-2',
        base_version: 0,
        operation: 'upsert',
        payload: '{}',
        created_at: '2026-07-12T00:01:00.000Z',
        attempt_count: 1,
        next_attempt_at: '2026-07-12T01:00:00.000Z',
        last_error_code: 'network_error'
      }
    ]
    state.openConflicts = 0
    state.syncStates.clear()
  })

  it('returns only due outbox operations in creation order', async () => {
    const { listPendingOutbox } = await import('../../../src/main/store/sync-repo')

    const pending = listPendingOutbox(10, '2026-07-12T00:30:00.000Z')

    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ operationId: 'due', entityType: 'setting' })
    expect(pending[0]?.payload).toEqual({ key: 'refresh_interval_min', value: 15 })
  })

  it('removes only acknowledged operations', async () => {
    const { acknowledgeOutboxOperations } = await import('../../../src/main/store/sync-repo')

    acknowledgeOutboxOperations(['due'])

    expect(state.outbox.map((row) => row.operation_id)).toEqual(['future'])
  })

  it('persists and reads a sync cursor state', async () => {
    const { getSyncState, saveSyncState } = await import('../../../src/main/store/sync-repo')

    saveSyncState({
      scope: 'default',
      cursor: 'cursor-123',
      lastSuccessAt: '2026-07-12T00:30:00.000Z',
      bootstrapRequired: false
    })

    expect(getSyncState()).toEqual({
      scope: 'default',
      cursor: 'cursor-123',
      lastSuccessAt: '2026-07-12T00:30:00.000Z',
      lastErrorCode: null,
      bootstrapRequired: false
    })
  })

  it('summarizes local sync status without exposing the raw cursor', async () => {
    const { getLocalSyncStatus, saveSyncState } = await import('../../../src/main/store/sync-repo')
    state.openConflicts = 2
    saveSyncState({
      scope: 'default',
      cursor: 'opaque-cursor',
      lastSuccessAt: '2026-07-12T00:30:00.000Z',
      lastErrorCode: 'network_error',
      bootstrapRequired: false
    })

    expect(getLocalSyncStatus()).toEqual({
      mode: 'local-only',
      state: 'error',
      pendingOutboxCount: 2,
      openConflictCount: 2,
      cursorPresent: true,
      lastSuccessAt: '2026-07-12T00:30:00.000Z',
      lastErrorCode: 'network_error',
      bootstrapRequired: false
    })
  })
})
