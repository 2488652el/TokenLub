/** 余额快照同步映射测试:快照暂不入 outbox,但必须拥有稳定同步身份。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface BalanceRow {
  id: number
  api_key_id: string
  provider_id: string
  total: number | null
  used: number | null
  remaining: number | null
  currency: string | null
  captured_at: string
  raw_json: string | null
}

const state = vi.hoisted(() => ({
  balances: [] as BalanceRow[],
  entityIds: new Map<string, string>(),
  outboxWrites: 0,
  nextId: 1,
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
          if (sql.includes('INSERT INTO balance_snapshots')) {
            const id = state.nextId++
            state.balances.push({
              id,
              api_key_id: String(args[0]),
              provider_id: String(args[1]),
              total: args[2] as number | null,
              used: args[3] as number | null,
              remaining: args[4] as number | null,
              currency: args[5] as string | null,
              captured_at: String(args[6]),
              raw_json: args[7] as string | null
            })
            return { changes: 1, lastInsertRowid: id }
          }
          if (sql.includes('INSERT INTO sync_entity_map')) {
            state.entityIds.set(`${args[0]}:${args[1]}`, String(args[2]))
          }
          if (sql.includes('INSERT INTO sync_outbox')) {
            state.outboxWrites++
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

describe('balance sync identity map', () => {
  beforeEach(() => {
    vi.resetModules()
    state.balances.length = 0
    state.entityIds.clear()
    state.outboxWrites = 0
    state.nextId = 1
    state.transactionCalls = 0
  })

  it('assigns a stable sync id to a new balance snapshot without queuing upload', async () => {
    const { insertBalance } = await import('../../../src/main/store/balance-repo')

    insertBalance({
      apiKeyId: 'key-1',
      providerId: 'openrouter',
      total: 100,
      used: 40,
      remaining: 60,
      currency: 'USD',
      capturedAt: '2026-07-12T00:00:00.000Z',
      raw: { providerSecretShape: 'must stay local' }
    })

    expect(state.transactionCalls).toBe(1)
    expect(state.balances).toHaveLength(1)
    expect(state.entityIds.get('balance_snapshot:1')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    )
    expect(state.outboxWrites).toBe(0)
  })
})
