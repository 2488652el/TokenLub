/**
 * 用量成本显示定价配置测试:覆盖请求日志重定价、仪表盘聚合重定价与模型对比聚合的 token 拆分保留。
 * (glm-5.2)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  rows: [
    {
      id: 1,
      api_key_id: null,
      provider_id: 'codex',
      billing_scope: 'default',
      model: 'gpt-5.5',
      period_start: null,
      period_end: null,
      prompt_tokens: 1_000_000,
      completion_tokens: 500_000,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 1_500_000,
      cost: 0,
      currency: null,
      source: 'session-log',
      session_id: 's1',
      message_id: 'm1',
      agent_label: null,
      captured_at: '2026-07-08T10:00:00.000Z'
    }
  ],
  pricing: {
    id: 1,
    providerId: 'codex',
    model: 'gpt-5.5',
    promptPricePerMtok: 10,
    completionPricePerMtok: 20,
    currency: 'USD',
    source: 'user' as const,
    updatedAt: '2026-07-08T00:00:00.000Z'
  }
}))

vi.mock('../../../src/main/store/pricing-repo', () => ({
  findPricing: vi.fn(() => state.pricing),
  findPricingByModel: vi.fn(() => null)
}))

vi.mock('../../../src/main/store/db', () => ({
  getDb: vi.fn(() => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT * FROM usage_records')) {
        return { all: vi.fn(() => state.rows) }
      }
      if (sql.includes('COUNT(*) AS totalRequests')) {
        return {
          get: vi.fn(() => ({
            totalInputTokens: 1_000_000,
            totalOutputTokens: 500_000,
            totalCacheReadTokens: 0,
            totalRequests: 1
          }))
        }
      }
      if (sql.includes('GROUP BY date, provider_id, billing_scope, model')) {
        return {
          all: vi.fn(() => [
            {
              date: '2026-07-08',
              provider_id: 'codex',
              billing_scope: 'default',
              model: 'gpt-5.5',
              pt: 1_000_000,
              ct: 500_000,
              crt: 0,
              cct: 0,
              stored_cost: 0
            }
          ])
        }
      }
      if (sql.includes('GROUP BY provider_id, billing_scope, model')) {
        return {
          all: vi.fn(() => [
            {
              provider_id: 'codex',
              billing_scope: 'default',
              model: 'gpt-5.5',
              pt: 1_000_000,
              ct: 500_000,
              crt: 0,
              cct: 0,
              tt: 1_500_000,
              stored_cost: 0,
              n: 1
            }
          ])
        }
      }
      throw new Error(`unexpected SQL: ${sql}`)
    }
  }))
}))

// 用量成本显示定价配置测试组:覆盖请求日志、仪表盘聚合与模型对比聚合的重定价
describe('usage cost display uses pricing config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reprices request log rows from current pricing entries', async () => {
    const { queryUsage } = await import('../../../src/main/store/usage-repo')
    const rows = queryUsage({ limit: 10 })
    expect(rows[0]?.cost).toBe(20)
    expect(rows[0]?.currency).toBe('USD')
  })

  it('reprices dashboard provider and daily cost aggregates', async () => {
    const { getDashboardSummary } = await import('../../../src/main/store/usage-repo')
    const summary = getDashboardSummary(30)
    expect(summary.totalCost).toBe(20)
    expect(summary.providers[0]).toMatchObject({ providerId: 'codex', cost: 20, pct: 1 })
    expect(summary.daily[0]).toMatchObject({ date: '2026-07-08', cost: 20 })
  })

  it('reprices model comparison aggregates and keeps token splits', async () => {
    const { computeModelSpend } = await import('../../../src/main/store/usage-repo')
    const models = computeModelSpend()
    expect(models[0]).toMatchObject({
      model: 'gpt-5.5',
      total: 20,
      currency: 'USD',
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheReadTokens: 0
    })
  })
})
