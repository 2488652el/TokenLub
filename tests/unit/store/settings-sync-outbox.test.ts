/**
 * 设置同步 outbox 测试:只同步用户偏好,并保证业务写入与 outbox 在同一事务中完成。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  entityIds: new Map<string, string>(),
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
            const id = state.entityIds.get(`${args[0]}:${args[1]}`)
            return id ? { sync_id: id, sync_version: 0 } : undefined
          }
          return undefined
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO app_settings')) {
            state.settings.set(String(args[0]), String(args[1]))
          }
          if (sql.includes('INSERT INTO sync_entity_map')) {
            state.entityIds.set(`${args[0]}:${args[1]}`, String(args[2]))
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
    state.entityIds.clear()
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
})
