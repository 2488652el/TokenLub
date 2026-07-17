import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  pricing: [] as Array<Record<string, unknown>>,
  balances: [] as Array<Record<string, unknown>>,
  revision: 0,
  lastSuccessAt: null as string | null,
  dirty: false,
  baseSnapshot: null as string | null,
  mutationGeneration: 0,
  transactions: 0
}))

const db = {
  name: 'C:/TokenLub/tokenlub.db',
  prepare(sql: string) {
    return {
      get: (...args: unknown[]) => {
        if (sql.includes('SELECT revision FROM sync_v2_state')) return { revision: state.revision }
        if (sql.includes('SELECT dirty FROM sync_v2_state')) return { dirty: state.dirty ? 1 : 0 }
        if (sql.includes('SELECT mutation_generation FROM sync_v2_state')) {
          return { mutation_generation: state.mutationGeneration }
        }
        if (sql.includes('SELECT base_snapshot FROM sync_v2_state')) {
          return { base_snapshot: state.baseSnapshot }
        }
        if (sql.includes('SELECT value FROM app_settings')) {
          const value = state.settings.get(String(args[0]))
          return value === undefined ? undefined : { value }
        }
        return undefined
      },
      all: () => {
        if (sql.includes('SELECT * FROM pricing_entries')) return state.pricing
        if (sql.includes('FROM balance_snapshots')) return state.balances
        return []
      },
      run: (...args: unknown[]) => {
        if (sql.includes('DELETE FROM app_settings')) {
          state.settings.delete(String(args[0]))
        } else if (sql.includes('DELETE FROM balance_snapshots WHERE sync_id')) {
          state.balances = state.balances.filter((item) => item.sync_id !== args[0])
        } else if (sql.includes('INSERT INTO app_settings')) {
          state.settings.set(String(args[0]), String(args[1]))
        } else if (sql.includes('DELETE FROM pricing_entries')) {
          state.pricing = []
        } else if (sql.includes('INSERT INTO pricing_entries')) {
          state.pricing.push({
            provider_id: args[0],
            billing_scope: args[1],
            model: args[2],
            currency: args[7],
            source: args[8],
            catalog_active: args[9]
          })
        } else if (sql.includes('INSERT INTO balance_snapshots')) {
          const row = {
            sync_id: args[6],
            provider_id: args[0],
            total: args[1],
            used: args[2],
            remaining: args[3],
            currency: args[4],
            captured_at: args[5],
            api_key_id: null,
            raw_json: null
          }
          const index = state.balances.findIndex((item) => item.sync_id === row.sync_id)
          if (index < 0) state.balances.push(row)
          else {
            state.balances[index] = {
              ...row,
              api_key_id: state.balances[index]?.api_key_id ?? null,
              raw_json: state.balances[index]?.raw_json ?? null
            }
          }
        } else if (sql.includes('INSERT INTO sync_v2_state')) {
          state.revision = Number(args[0])
          state.lastSuccessAt = String(args[1])
          state.dirty = false
          state.baseSnapshot = String(args[2])
        } else if (sql.includes('UPDATE sync_v2_state SET dirty = 1')) {
          state.dirty = true
          state.mutationGeneration++
        }
        return { changes: 1 }
      }
    }
  },
  transaction<T>(run: () => T) {
    return () => {
      state.transactions++
      return run()
    }
  }
}

vi.mock('../../../../code/src/main/store/db', () => ({ getDb: () => db }))

import {
  applySyncV2Snapshot,
  createSyncV2Snapshot,
  getSyncV2Preview,
  getSyncV2BaseSnapshot,
  getSyncV2Revision,
  isSyncV2Dirty,
  markSyncV2Dirty
} from '../../../../code/src/main/store/sync-v2-repo'

describe('local Sync V2 snapshot repository', () => {
  beforeEach(() => {
    state.settings = new Map()
    state.pricing = []
    state.balances = []
    state.revision = 0
    state.lastSuccessAt = null
    state.dirty = false
    state.baseSnapshot = null
    state.mutationGeneration = 0
    state.transactions = 0
  })

  it('exports only allowlisted settings and redacted balance fields', () => {
    state.settings.set('refresh_interval_min', '15')
    state.settings.set('last_refresh_at', JSON.stringify('local-only'))
    state.settings.set('api_token', JSON.stringify('secret'))
    state.balances.push({
      sync_id: '550e8400-e29b-41d4-a716-446655440000',
      provider_id: 'openai',
      total: null,
      used: null,
      remaining: 10,
      currency: null,
      captured_at: '2026-07-14T00:00:00.000Z',
      api_key_id: 'local-key-id',
      raw_json: JSON.stringify({ credential: 'raw-secret' })
    })

    const snapshot = createSyncV2Snapshot()
    expect(snapshot.settings).toEqual({ refresh_interval_min: 15 })
    expect(JSON.stringify(snapshot)).not.toContain('secret')
    expect(JSON.stringify(snapshot)).not.toContain('local-key-id')
    expect(snapshot.balances[0]).toEqual({
      id: '550e8400-e29b-41d4-a716-446655440000',
      providerId: 'openai',
      capturedAt: '2026-07-14T00:00:00.000Z',
      remaining: 10
    })
  })

  it('uses the configured local backup directory in the sync preview', () => {
    state.settings.set('sync_backup_directory', JSON.stringify('D:/TokenLub/backups'))

    expect(getSyncV2Preview('merge').backupDirectory).toBe('D:/TokenLub/backups')
  })

  it('applies the canonical snapshot in one transaction while preserving local-only settings', () => {
    state.settings.set('refresh_interval_min', '30')
    state.settings.set('last_refresh_at', JSON.stringify('keep-me'))

    applySyncV2Snapshot(
      {
        settings: { session_auto_parse_enabled: true },
        pricing: [
          {
            providerId: 'openai',
            billingScope: 'global',
            model: 'gpt-test',
            currency: 'USD',
            promptPricePerMtok: 1,
            completionPricePerMtok: 2,
            source: 'user'
          }
        ],
        balances: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            providerId: 'openai',
            capturedAt: '2026-07-14T00:00:00.000Z',
            remaining: 8
          }
        ]
      },
      7,
      '2026-07-14T01:00:00.000Z'
    )

    expect(Object.fromEntries(state.settings)).toEqual({
      last_refresh_at: JSON.stringify('keep-me'),
      session_auto_parse_enabled: 'true'
    })
    expect(getSyncV2Revision()).toBe(7)
    expect(state.pricing).toHaveLength(1)
    expect(state.pricing[0]).toMatchObject({
      provider_id: 'openai',
      billing_scope: 'global',
      model: 'gpt-test',
      currency: 'USD',
      source: 'user',
      catalog_active: 1
    })
    expect(state.balances[0]).toMatchObject({ api_key_id: null, raw_json: null })
    expect(state.transactions).toBe(1)
    expect(isSyncV2Dirty()).toBe(false)
    expect(getSyncV2BaseSnapshot()).toMatchObject({
      settings: { session_auto_parse_enabled: true }
    })
  })

  it('tracks unsynced local changes separately from the cloud revision', () => {
    markSyncV2Dirty()

    expect(isSyncV2Dirty()).toBe(true)
    expect(getSyncV2Revision()).toBe(0)
  })

  it('preserves local balance ownership and raw data when applying a redacted copy', () => {
    state.balances.push({
      sync_id: '550e8400-e29b-41d4-a716-446655440000',
      provider_id: 'openai',
      total: null,
      used: null,
      remaining: 10,
      currency: 'USD',
      captured_at: '2026-07-14T00:00:00.000Z',
      api_key_id: 'local-key',
      raw_json: '{"private":true}'
    })

    applySyncV2Snapshot(
      {
        settings: {},
        pricing: [],
        balances: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            providerId: 'openai',
            remaining: 8,
            currency: 'USD',
            capturedAt: '2026-07-14T00:00:00.000Z'
          }
        ]
      },
      1,
      '2026-07-14T01:00:00.000Z'
    )

    expect(state.balances[0]).toMatchObject({
      api_key_id: 'local-key',
      raw_json: '{"private":true}',
      remaining: 8
    })
  })
})
