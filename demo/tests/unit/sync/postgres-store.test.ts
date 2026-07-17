import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PostgresPhase1Store,
  type PostgresQueryClient
} from '../../../../drive/src/server/postgres-store'
import type { SyncV2Snapshot } from '../../../../code/src/shared/sync-v2'

const snapshot: SyncV2Snapshot = {
  settings: { refresh_interval_min: 30 },
  pricing: [],
  balances: []
}

describe('PostgresPhase1Store Sync V2', () => {
  it('reads a stored snapshot and normalizes PostgreSQL values', async () => {
    const store = new PostgresPhase1Store({
      query: async () => ({
        rows: [
          {
            revision: '2',
            snapshot,
            updated_at: new Date('2026-07-13T00:00:00.000Z')
          }
        ]
      })
    })

    await expect(store.getSyncV2Snapshot('user-1')).resolves.toEqual({
      revision: 2,
      snapshot,
      updatedAt: '2026-07-13T00:00:00.000Z'
    })
  })

  it('uses a revision-guarded update for an existing snapshot', async () => {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = []
    const client: PostgresQueryClient = {
      query: async (sql, params) => {
        calls.push({ sql, ...(params ? { params } : {}) })
        return {
          rows: [
            {
              revision: 4,
              snapshot,
              updated_at: '2026-07-13T00:00:00.000Z'
            }
          ]
        }
      }
    }
    const store = new PostgresPhase1Store(client)

    await expect(
      store.compareAndSwapSyncV2Snapshot({
        userId: 'user-1',
        expectedRevision: 3,
        snapshot,
        updatedAt: '2026-07-13T00:00:00.000Z'
      })
    ).resolves.toMatchObject({ revision: 4, snapshot })

    expect(calls[0]?.sql).toContain('UPDATE user_sync_snapshots')
    expect(calls[0]?.sql).toContain('WHERE user_id = $1 AND revision = $2')
    expect(calls[0]?.params).toEqual([
      'user-1',
      3,
      JSON.stringify(snapshot),
      '2026-07-13T00:00:00.000Z'
    ])
  })

  it('only inserts revision one when the snapshot does not already exist', async () => {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = []
    const store = new PostgresPhase1Store({
      query: async (sql, params) => {
        calls.push({ sql, ...(params ? { params } : {}) })
        return {
          rows: [
            {
              revision: 1,
              snapshot,
              updated_at: '2026-07-13T00:00:00.000Z'
            }
          ]
        }
      }
    })

    await store.compareAndSwapSyncV2Snapshot({
      userId: 'user-1',
      expectedRevision: 0,
      snapshot,
      updatedAt: '2026-07-13T00:00:00.000Z'
    })

    expect(calls[0]?.sql).toContain('INSERT INTO user_sync_snapshots')
    expect(calls[0]?.sql).toContain('VALUES ($1, 1, $2::jsonb, $3)')
    expect(calls[0]?.sql).toContain('ON CONFLICT (user_id) DO NOTHING')
    expect(calls[0]?.params).toEqual([
      'user-1',
      JSON.stringify(snapshot),
      '2026-07-13T00:00:00.000Z'
    ])
  })

  it('uses one checked-out connection for data deletion', async () => {
    const poolQueries: string[] = []
    const transactionQueries: string[] = []
    let releases = 0
    const store = new PostgresPhase1Store({
      query: async (sql) => {
        poolQueries.push(sql)
        return { rows: [] }
      },
      connect: async () => ({
        query: async (sql) => {
          transactionQueries.push(sql.trim())
          return { rows: [] }
        },
        release: () => {
          releases++
        }
      })
    })

    await store.deleteUserData('user-1')

    expect(poolQueries).toEqual([])
    expect(transactionQueries[0]).toBe('BEGIN')
    expect(transactionQueries.at(-1)).toBe('COMMIT')
    expect(releases).toBe(1)
  })

  it('exports the V2 snapshot and deletes V2 plus legacy user data transactionally', async () => {
    const queries: string[] = []
    const store = new PostgresPhase1Store({
      query: async (sql) => {
        queries.push(sql.trim())
        if (sql.includes('FROM user_sync_snapshots')) {
          return {
            rows: [
              {
                revision: 3,
                snapshot,
                updated_at: '2026-07-13T00:00:00.000Z'
              }
            ]
          }
        }
        return { rows: [] }
      }
    })

    await expect(store.exportUserData('user-1')).resolves.toEqual({
      exportedAt: expect.any(String),
      revision: 3,
      snapshot,
      updatedAt: '2026-07-13T00:00:00.000Z'
    })
    await store.deleteUserData('user-1')

    expect(queries).toContain('DELETE FROM user_sync_snapshots WHERE user_id = $1')
    expect(queries).toContain('DELETE FROM sync_entities WHERE user_id = $1')
    expect(queries.at(-1)).toBe('COMMIT')
  })

  it('reports snapshot storage and queue metrics as numbers', async () => {
    const store = new PostgresPhase1Store({
      query: async () => ({
        rows: [
          {
            database_bytes: '2048',
            sync_changes_bytes: '512',
            queue_backlog: '2',
            client_versions: { '1.0.2': '3' }
          }
        ]
      })
    })

    await expect(store.getOperationalMetrics()).resolves.toEqual({
      databaseBytes: 2048,
      syncChangesBytes: 512,
      queueBacklog: 2,
      clientVersions: { '1.0.2': 3 }
    })
  })
})

describe('Sync V2 PostgreSQL migration', () => {
  it('defines one revisioned snapshot per user with JSON object validation', () => {
    const table = readFileSync(
      resolve('drive/src/server/migrations/008_sync_v2_snapshot.sql'),
      'utf8'
    )
    const constraint = readFileSync(
      resolve('drive/src/server/migrations/009_sync_v2_snapshot_shape.sql'),
      'utf8'
    )

    expect(table).toContain('CREATE TABLE IF NOT EXISTS user_sync_snapshots')
    expect(table).toContain('user_id UUID PRIMARY KEY')
    expect(constraint).toContain("jsonb_typeof(snapshot) = 'object'")
  })
})
