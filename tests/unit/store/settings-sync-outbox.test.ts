/**
 * 设置同步 outbox 测试:只同步用户偏好,并保证业务写入与 outbox 在同一事务中完成。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  entityMaps: new Map<string, { syncId: string; syncVersion: number }>(),
  outbox: [] as Array<{
    operationId: string
    entityType: string
    entityId: string
    baseVersion: number
    operation: string
    payload: string
  }>,
  transactionCalls: 0
}))

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('SELECT sync_id, sync_version FROM sync_entity_map')) {
            const row = state.entityMaps.get(`${args[0]}:${args[1]}`)
            return row ? { sync_id: row.syncId, sync_version: row.syncVersion } : undefined
          }
          return undefined
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO app_settings')) {
            state.settings.set(String(args[0]), String(args[1]))
          }
          if (sql.includes('INSERT INTO sync_entity_map')) {
            state.entityMaps.set(`${args[0]}:${args[1]}`, {
              syncId: String(args[2]),
              syncVersion: Number(args[3])
            })
          }
          if (sql.includes('UPDATE sync_entity_map')) {
            const key = `${args[3]}:${args[4]}`
            const existing = state.entityMaps.get(key)
            state.entityMaps.set(key, {
              syncId: existing?.syncId ?? '',
              syncVersion: Number(args[0])
            })
          }
          if (sql.includes('INSERT INTO sync_outbox')) {
            state.outbox.push({
              operationId: String(args[0]),
              entityType: String(args[1]),
              entityId: String(args[2]),
              baseVersion: Number(args[3]),
              operation: String(args[4]),
              payload: String(args[5])
            })
          }
          return { changes: 1 }
        },
        all: () => []
      }
    },
    transaction<T>(work: () => T) {
      return () => {
        state.transactionCalls++
        return work()
      }
    }
  })
}))

describe('settings sync outbox', () => {
  beforeEach(() => {
    vi.resetModules()
    state.settings.clear()
    state.entityMaps.clear()
    state.outbox.length = 0
    state.transactionCalls = 0
  })

  it('writes refresh_interval_min and its upsert operation in one transaction', async () => {
    const { setSetting } = await import('../../../src/main/store/settings-store')

    setSetting('refresh_interval_min', 15)

    expect(state.transactionCalls).toBe(1)
    expect(state.settings.get('refresh_interval_min')).toBe('15')
    expect(state.outbox).toHaveLength(1)
    expect(state.outbox[0]).toMatchObject({
      entityType: 'setting',
      baseVersion: 0,
      operation: 'upsert'
    })
    expect(JSON.parse(state.outbox[0]!.payload)).toEqual({ key: 'refresh_interval_min', value: 15 })
  })

  it('keeps last_refresh_at local without adding a sync operation', async () => {
    const { setSetting } = await import('../../../src/main/store/settings-store')

    setSetting('last_refresh_at', '2026-07-11T00:00:00.000Z')

    expect(state.settings.get('last_refresh_at')).toBe('"2026-07-11T00:00:00.000Z"')
    expect(state.outbox).toHaveLength(0)
  })

  it('applies remote settings without echoing them back into outbox', async () => {
    const { applyRemoteSettingChange } = await import('../../../src/main/store/settings-store')

    applyRemoteSettingChange({
      entityId: 'setting-sync-id',
      key: 'refresh_interval_min',
      value: 20,
      version: 4
    })
    applyRemoteSettingChange({
      entityId: 'setting-sync-id',
      key: 'refresh_interval_min',
      value: 20,
      version: 4
    })

    expect(state.transactionCalls).toBe(2)
    expect(state.settings.get('refresh_interval_min')).toBe('20')
    expect(state.entityMaps.get('setting:refresh_interval_min')).toEqual({
      syncId: 'setting-sync-id',
      syncVersion: 4
    })
    expect(state.outbox).toHaveLength(0)
  })
})
