/** 用户定价同步 outbox 测试:目录价格不参与同步，用户价格与 outbox 必须同事务写入。 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

interface PricingRow {
  id: number
  provider_id: string
  model: string
  prompt_price_per_mtok: number
  completion_price_per_mtok: number
  cache_read_price_per_mtok: number | null
  cache_creation_price_per_mtok: number | null
  currency: string
  source: string
  updated_at: string
}

const state = vi.hoisted(() => ({
  pricing: new Map<string, PricingRow>(),
  entityMaps: new Map<string, { syncId: string; syncVersion: number }>(),
  outbox: [] as Array<{ entityType: string; entityId: string; payload: string }>,
  nextId: 1,
  transactionCalls: 0
}))

function pricingKey(providerId: string, model: string, currency: string): string {
  return `${providerId}:${model}:${currency}`
}

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare(sql: string) {
      return {
        get: (...args: unknown[]) => {
          if (sql.includes('SELECT sync_id, sync_version FROM sync_entity_map')) {
            const row = state.entityMaps.get(`${args[0]}:${args[1]}`)
            return row ? { sync_id: row.syncId, sync_version: row.syncVersion } : undefined
          }
          if (sql.includes('SELECT * FROM pricing_entries WHERE provider_id')) {
            return state.pricing.get(pricingKey(String(args[0]), String(args[1]), String(args[2])))
          }
          return undefined
        },
        run: (...args: unknown[]) => {
          if (sql.includes('INSERT INTO pricing_entries')) {
            const [providerId, model, prompt, completion, cacheRead, cacheCreation, currency, source, updatedAt] = args
            const key = pricingKey(String(providerId), String(model), String(currency))
            const existing = state.pricing.get(key)
            state.pricing.set(key, {
              id: existing?.id ?? state.nextId++,
              provider_id: String(providerId),
              model: String(model),
              prompt_price_per_mtok: Number(prompt),
              completion_price_per_mtok: Number(completion),
              cache_read_price_per_mtok: cacheRead as number | null,
              cache_creation_price_per_mtok: cacheCreation as number | null,
              currency: String(currency),
              source: String(source),
              updated_at: String(updatedAt)
            })
          }
          if (sql.includes('INSERT INTO sync_entity_map')) {
            state.entityMaps.set(`${args[0]}:${args[1]}`, {
              syncId: String(args[2]),
              syncVersion: Number(args[3])
            })
          }
          if (sql.includes('INSERT INTO sync_outbox')) {
            state.outbox.push({
              entityType: String(args[1]),
              entityId: String(args[2]),
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

describe('pricing sync outbox', () => {
  beforeEach(() => {
    vi.resetModules()
    state.pricing.clear()
    state.entityMaps.clear()
    state.outbox.length = 0
    state.nextId = 1
    state.transactionCalls = 0
  })

  it('queues a user price update with a stable entity id in the same transaction', async () => {
    const { setPricing } = await import('../../../src/main/store/pricing-repo')

    const saved = setPricing({
      providerId: 'openrouter',
      model: 'example-model',
      promptPricePerMtok: 1.2,
      completionPricePerMtok: 4.8,
      currency: 'USD',
      source: 'user'
    })

    expect(state.transactionCalls).toBe(1)
    expect(saved.id).toBe(1)
    expect(state.outbox).toHaveLength(1)
    expect(state.outbox[0]?.entityType).toBe('model_pricing')
    expect(JSON.parse(state.outbox[0]!.payload)).toMatchObject({
      providerId: 'openrouter',
      model: 'example-model',
      promptPricePerMtok: 1.2,
      completionPricePerMtok: 4.8,
      currency: 'USD'
    })
  })

  it('does not queue catalog prices for cloud synchronization', async () => {
    const { setPricing } = await import('../../../src/main/store/pricing-repo')

    setPricing({
      providerId: 'openrouter',
      model: 'catalog-model',
      promptPricePerMtok: 1,
      completionPricePerMtok: 2,
      currency: 'USD',
      source: 'catalog'
    })

    expect(state.outbox).toHaveLength(0)
  })

  it('applies remote user pricing without echoing it back into outbox', async () => {
    const { applyRemotePricingChange } = await import('../../../src/main/store/pricing-repo')

    const saved = applyRemotePricingChange({
      entityId: 'pricing-sync-id',
      version: 5,
      payload: {
        providerId: 'openrouter',
        model: 'remote-model',
        promptPricePerMtok: 1.5,
        completionPricePerMtok: 5,
        currency: 'USD',
        source: 'user'
      }
    })

    expect(state.transactionCalls).toBe(1)
    expect(saved.id).toBe(1)
    expect(state.pricing.get('openrouter:remote-model:USD')).toMatchObject({
      prompt_price_per_mtok: 1.5,
      completion_price_per_mtok: 5,
      source: 'user'
    })
    expect(state.entityMaps.get('model_pricing:1')).toEqual({
      syncId: 'pricing-sync-id',
      syncVersion: 5
    })
    expect(state.outbox).toHaveLength(0)
  })
})
