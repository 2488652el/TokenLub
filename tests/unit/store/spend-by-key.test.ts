import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Spend estimate test harness.
 *
 * We fake the whole `getDb` module with a hand-rolled query runner that
 * returns the right shape. Schema mirrors the prod `usage_records` table;
 * pricing lookups query the same fake `pricing_entries` rows.
 * 中文说明:按 Key 花费估算的存储层测试。 (glm-5.2)
 */

interface UsageRow {
  api_key_id: string | null
  provider_id: string
  model: string
  prompt_tokens: number | null
  completion_tokens: number | null
  cache_creation_tokens: number | null
  cache_read_tokens: number | null
  captured_at: string
}

interface PricingRow {
  provider_id: string
  model: string
  prompt_price_per_mtok: number
  completion_price_per_mtok: number
  cache_read_price_per_mtok: number | null
  cache_creation_price_per_mtok: number | null
  currency: string
  source: 'catalog' | 'user'
}

let usage: UsageRow[] = []
let pricing: PricingRow[] = []
let apiKeys: Array<{ id: string; provider_id: string }> = []

function reset() {
  usage = []
  pricing = []
  apiKeys = []
}

function fakeQuery(sql: string, args: unknown[]) {
  // The usage aggregation queries:
  //   1) SELECT provider_id, model, ... FROM usage_records WHERE api_key_id = ?
  //      AND captured_at >= ? GROUP BY provider_id, model
  //   2) fallback SELECT for unassigned session-log rows by key provider
  //   3) global SELECT for all rows in the dashboard window
  //   4) pricing lookups by exact provider+model or model-only
  if (sql.includes('FROM usage_records')) {
    const fallbackProviderId = sql.includes('api_key_id IS NULL') ? (args[0] as string) : null
    const isKeyQuery = sql.includes('api_key_id = ?')
    const apiKeyId = fallbackProviderId || !isKeyQuery ? null : (args[0] as string)
    const sinceISO = fallbackProviderId || isKeyQuery ? (args[1] as string) : (args[0] as string)
    const since = Date.parse(sinceISO)
    const filtered = usage.filter((r) => {
      if (Date.parse(r.captured_at) < since) return false
      if (fallbackProviderId) {
        return (
          r.api_key_id === null &&
          pricing.some((p) => p.provider_id === fallbackProviderId && p.model === r.model)
        )
      }
      if (!isKeyQuery) return true
      return r.api_key_id === apiKeyId
    })
    // GROUP BY provider_id, model
    const groups = new Map<
      string,
      UsageRow & { pt: number; ct: number; crt: number; cct: number; n: number }
    >()
    for (const r of filtered) {
      const key = `${r.provider_id}::${r.model}`
      const prev = groups.get(key)
      if (prev) {
        prev.pt += r.prompt_tokens ?? 0
        prev.ct += r.completion_tokens ?? 0
        prev.crt += r.cache_read_tokens ?? 0
        prev.cct += r.cache_creation_tokens ?? 0
        prev.n++
      } else {
        groups.set(key, {
          ...r,
          pt: r.prompt_tokens ?? 0,
          ct: r.completion_tokens ?? 0,
          crt: r.cache_read_tokens ?? 0,
          cct: r.cache_creation_tokens ?? 0,
          n: 1
        })
      }
    }
    return Array.from(groups.values())
  }
  if (sql.includes('FROM pricing_entries')) {
    const modelOnly = sql.includes('WHERE model = ?')
    const preferredCurrency = (modelOnly ? args[1] : args[2]) as string
    const rows = pricing
      .filter((p) => {
        if (modelOnly) return p.model === args[0]
        return p.provider_id === args[0] && p.model === args[1]
      })
      .sort((a, b) => {
        const currencyRank =
          Number(a.currency !== preferredCurrency) - Number(b.currency !== preferredCurrency)
        if (currencyRank !== 0) return currencyRank
        const sourceRank = Number(a.source !== 'user') - Number(b.source !== 'user')
        return sourceRank
      })
    return rows.slice(0, 1)
  }
  throw new Error(`unexpected SQL in test: ${sql}`)
}

function fakeGet(sql: string, args: unknown[]) {
  if (sql.includes('FROM api_keys')) {
    const id = args[0] as string
    return apiKeys.find((k) => k.id === id)
  }
  throw new Error(`unexpected SQL in test: ${sql}`)
}

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: (...args: unknown[]) => fakeQuery(sql, args),
      get: (...args: unknown[]) => fakeGet(sql, args)
    })
  })
}))

import {
  computeModelSpend,
  computeSpendByKey,
  computeTotalSpend
} from '../../../src/main/store/usage-repo'

beforeEach(() => {
  reset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function insertUsage(rows: UsageRow[]) {
  usage.push(...rows)
}
function insertPricing(rows: PricingRow[]) {
  pricing.push(...rows)
}
function insertKeys(rows: Array<{ id: string; provider_id: string }>) {
  apiKeys.push(...rows)
}

// 按 Key 花费估算测试套件:验证空用量、定价汇总、多币种、时间窗口与未分配行回退等场景
describe('computeSpendByKey (per-key spend estimate)', () => {
  it('returns zero total + no usage for a key with no usage', () => {
    insertUsage([
      {
        api_key_id: 'k1',
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      }
    ])
    const r = computeSpendByKey('k-no-usage', 30)
    expect(r.total).toBe(0)
    expect(r.totalRequests).toBe(0)
    expect(r.models).toEqual([])
  })

  it('sums prompt + completion cost across (provider, model) groups', () => {
    insertPricing([
      {
        provider_id: 'anthropic-admin',
        model: 'claude-opus-4-8',
        prompt_price_per_mtok: 2,
        completion_price_per_mtok: 8,
        cache_read_price_per_mtok: null,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    // 100k prompt + 50k completion → 100k/1M * 2 + 50k/1M * 8 = 0.2 + 0.4 = 0.6
    insertUsage([
      {
        api_key_id: 'k-anth',
        provider_id: 'anthropic-admin',
        model: 'claude-opus-4-8',
        prompt_tokens: 100_000,
        completion_tokens: 50_000,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      }
    ])
    const r = computeSpendByKey('k-anth', 30)
    expect(r.total).toBeCloseTo(0.6, 6)
    expect(r.currency).toBe('CNY')
    expect(r.pricedRequests).toBe(1)
    expect(r.unpricedRequests).toBe(0)
    expect(r.models).toEqual(['claude-opus-4-8'])
  })

  it('separates priced and unpriced request counts', () => {
    insertPricing([
      {
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_price_per_mtok: 1,
        completion_price_per_mtok: 2,
        cache_read_price_per_mtok: null,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    insertUsage([
      {
        api_key_id: 'k-mix',
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      },
      {
        api_key_id: 'k-mix',
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_tokens: 500_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      },
      {
        api_key_id: 'k-mix',
        provider_id: 'deepseek',
        model: 'unknown-model',
        prompt_tokens: 100,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      },
      {
        api_key_id: 'k-mix',
        provider_id: 'deepseek',
        model: 'unknown-model',
        prompt_tokens: 100,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      }
    ])
    const r = computeSpendByKey('k-mix', 30)
    expect(r.totalRequests).toBe(4)
    expect(r.pricedRequests).toBe(2)
    expect(r.unpricedRequests).toBe(2)
    expect(r.total).toBeCloseTo(1.5, 6)
    expect(r.models.sort()).toEqual(['deepseek-v4-pro', 'unknown-model'])
  })

  it('multi-currency: picks the largest as primary', () => {
    insertPricing([
      {
        provider_id: 'openai-admin',
        model: 'gpt-5',
        prompt_price_per_mtok: 3,
        completion_price_per_mtok: 15,
        cache_read_price_per_mtok: null,
        cache_creation_price_per_mtok: null,
        currency: 'USD',
        source: 'catalog'
      },
      {
        provider_id: 'zhipu',
        model: 'glm-5.2',
        prompt_price_per_mtok: 0.1,
        completion_price_per_mtok: 0.2,
        cache_read_price_per_mtok: null,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    insertUsage([
      {
        api_key_id: 'k-multi',
        provider_id: 'openai-admin',
        model: 'gpt-5',
        prompt_tokens: 100_000,
        completion_tokens: 100_000,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      },
      {
        api_key_id: 'k-multi',
        provider_id: 'zhipu',
        model: 'glm-5.2',
        prompt_tokens: 100_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      }
    ])
    const r = computeSpendByKey('k-multi', 30)
    expect(r.byCurrency).toContainEqual({ currency: 'USD', amount: 1.8 })
    expect(r.byCurrency).toContainEqual({ currency: 'CNY', amount: 0.01 })
    expect(r.currency).toBe('USD')
    expect(r.total).toBe(1.8)
  })

  it('filters out rows outside the days window', () => {
    insertPricing([
      {
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_price_per_mtok: 1,
        completion_price_per_mtok: 2,
        cache_read_price_per_mtok: null,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    const old = new Date(Date.now() - 60 * 24 * 3600 * 1000).toISOString()
    const fresh = new Date().toISOString()
    insertUsage([
      {
        api_key_id: 'k-time',
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: old
      },
      {
        api_key_id: 'k-time',
        provider_id: 'deepseek',
        model: 'deepseek-v4-pro',
        prompt_tokens: 500_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: fresh
      }
    ])
    const r = computeSpendByKey('k-time', 30)
    expect(r.total).toBeCloseTo(0.5, 6)
    expect(r.totalRequests).toBe(1)
  })

  it('falls back to unassigned session-log rows priced by the key provider', () => {
    insertKeys([{ id: 'k-minimax', provider_id: 'minimax' }])
    insertPricing([
      {
        provider_id: 'minimax',
        model: 'MiniMax-M3',
        prompt_price_per_mtok: 2.1,
        completion_price_per_mtok: 8.4,
        cache_read_price_per_mtok: 0.42,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    insertUsage([
      {
        api_key_id: null,
        provider_id: 'claude-code',
        model: 'MiniMax-M3',
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        cache_creation_tokens: 0,
        cache_read_tokens: 500_000,
        captured_at: new Date().toISOString()
      },
      {
        api_key_id: null,
        provider_id: 'claude-code',
        model: 'glm-5.2',
        prompt_tokens: 1_000_000,
        completion_tokens: 0,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        captured_at: new Date().toISOString()
      }
    ])

    const r = computeSpendByKey('k-minimax', 30)

    // MiniMax row: 2.1 input + 0.84 output + 0.21 cache read = 3.15 CNY.
    // GLM row is ignored because this key's provider is minimax.
    expect(r.total).toBeCloseTo(3.15, 6)
    expect(r.currency).toBe('CNY')
    expect(r.totalRequests).toBe(1)
    expect(r.pricedRequests).toBe(1)
    expect(r.unpricedRequests).toBe(0)
    expect(r.models).toEqual(['MiniMax-M3'])
  })

  it('computes global spend from request-log model tokens when provider_id is only the log source', () => {
    insertPricing([
      {
        provider_id: 'minimax',
        model: 'MiniMax-M3',
        prompt_price_per_mtok: 2.1,
        completion_price_per_mtok: 8.4,
        cache_read_price_per_mtok: 0.42,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    insertUsage([
      {
        api_key_id: null,
        provider_id: 'claude-code',
        model: 'MiniMax-M3',
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        cache_creation_tokens: 0,
        cache_read_tokens: 500_000,
        captured_at: new Date().toISOString()
      }
    ])

    const r = computeTotalSpend(30)

    expect(r.total).toBeCloseTo(3.15, 6)
    expect(r.cnyTotal).toBeCloseTo(3.15, 6)
    expect(r.currency).toBe('CNY')
    expect(r.totalRequests).toBe(1)
    expect(r.pricedRequests).toBe(1)
    expect(r.unpricedRequests).toBe(0)
  })

  it('computes by-model table spend from pricing config instead of stored zero cost', () => {
    insertPricing([
      {
        provider_id: 'minimax',
        model: 'MiniMax-M3',
        prompt_price_per_mtok: 2.1,
        completion_price_per_mtok: 8.4,
        cache_read_price_per_mtok: 0.42,
        cache_creation_price_per_mtok: null,
        currency: 'CNY',
        source: 'catalog'
      }
    ])
    insertUsage([
      {
        api_key_id: null,
        provider_id: 'claude-code',
        model: 'MiniMax-M3',
        prompt_tokens: 1_000_000,
        completion_tokens: 100_000,
        cache_creation_tokens: 0,
        cache_read_tokens: 500_000,
        captured_at: new Date().toISOString()
      }
    ])

    const rows = computeModelSpend()

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      model: 'MiniMax-M3',
      providers: ['claude-code'],
      currency: 'CNY',
      requests: 1,
      pricedRequests: 1,
      unpricedRequests: 0
    })
    expect(rows[0]!.total).toBeCloseTo(3.15, 6)
  })
})
