/**
 * MiniMax 供应商单元测试:覆盖令牌计划余额解析、连通性探测、baseUrl 尾斜杠处理与定价种子校验。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { minimaxProvider } from '../../../src/main/providers/minimax'
import { MINIMAX_PRICING } from '../../../src/main/pricing/minimax-pricing'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

// minimaxProvider 测试组:覆盖令牌计划余额解析、连通性探测与 baseUrl 尾斜杠去重
describe('minimaxProvider', () => {
  it('reads remaining percent from the live model_remains payload shape', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(typeof input === 'string' ? input : input.toString()).toContain(
        '/v1/token_plan/remains'
      )
      return jsonResponse(200, {
        model_remains: [
          {
            model_name: 'general',
            current_interval_remaining_percent: 99,
            current_weekly_remaining_percent: 54
          },
          {
            model_name: 'video',
            current_interval_remaining_percent: 100,
            current_weekly_remaining_percent: 100
          }
        ],
        base_resp: { status_code: 0, status_msg: 'success' }
      })
    }) as typeof fetch

    const caps = minimaxProvider.build({ baseUrl: 'https://api.minimaxi.com/v1', apiKey: 't' })
    const snap = await caps.balance?.()
    expect(snap?.remaining).toBe(54)
    expect(snap?.total).toBe(100)
    expect(snap?.currency).toBe('CNY')
  })

  it('exposes token-plan balance capability via /v1/token_plan/remains', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(typeof input === 'string' ? input : input.toString()).toContain(
        '/v1/token_plan/remains'
      )
      return jsonResponse(200, {
        data: {
          current_five_hour_remaining_percent: 80,
          current_weekly_remaining_percent: 65
        }
      })
    }) as typeof fetch
    const caps = minimaxProvider.build({ baseUrl: 'https://api.minimaxi.com', apiKey: 't' })
    expect(minimaxProvider.hasBalanceApi).toBe(true)
    expect(minimaxProvider.hasUsageApi).toBe(false)
    expect(caps.balance).toBeDefined()
    const snap = await caps.balance?.()
    expect(snap?.providerId).toBe('minimax')
    expect(snap?.currency).toBe('CNY')
    expect(snap?.remaining).toBe(65)
    expect(snap?.total).toBe(100)
  })

  it('reports ok when /v1/models responds 200', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { data: [{ id: 'MiniMax-M3' }] })
    ) as typeof fetch
    const caps = minimaxProvider.build({ baseUrl: 'https://api.minimaxi.com/v1', apiKey: 'good' })
    const res = await caps.testConnection()
    expect(res.ok).toBe(true)
  })

  it('reports failure on a 401 (bad key)', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('Unauthorized', { status: 401 })
    ) as typeof fetch
    const caps = minimaxProvider.build({ baseUrl: 'https://api.minimaxi.com/v1', apiKey: 'bad' })
    const res = await caps.testConnection()
    expect(res.ok).toBe(false)
  })

  it('strips a trailing /v1 from baseUrl so /v1/models does not double up', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(typeof input === 'string' ? input : input.toString())
      return jsonResponse(200, { data: [] })
    }) as typeof fetch
    // Catalog default is `https://api.minimaxi.com/v1`; the provider must
    // request `/v1/models` (not `/v1/v1/models`).
    const caps = minimaxProvider.build({ baseUrl: 'https://api.minimaxi.com/v1', apiKey: 't' })
    await caps.testConnection()
    expect(seen.some((u) => u === 'https://api.minimaxi.com/v1/models')).toBe(true)
  })

  it('hits https://api.minimaxi.com/v1/models by default', async () => {
    const seen: string[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      seen.push(typeof input === 'string' ? input : input.toString())
      return jsonResponse(200, { data: [] })
    }) as typeof fetch
    const caps = minimaxProvider.build({ baseUrl: '', apiKey: 't' })
    await caps.testConnection()
    expect(seen.some((u) => u.startsWith('https://api.minimaxi.com/v1/models'))).toBe(true)
  })
})

// MINIMAX_PRICING 种子测试组:覆盖旗舰模型定价、货币一致性与高速版倍率
describe('MINIMAX_PRICING seed', () => {
  it('covers the current flagship MiniMax-M3 at the 50%-off rate', () => {
    const m3 = MINIMAX_PRICING.find((p) => p.model === 'MiniMax-M3')
    expect(m3).toBeDefined()
    expect(m3!.providerId).toBe('minimax')
    expect(m3!.currency).toBe('CNY')
    expect(m3!.promptPricePerMtok).toBe(2.1)
    expect(m3!.completionPricePerMtok).toBe(8.4)
    expect(m3!.cacheReadPricePerMtok).toBe(0.42)
    // M3 has no separate cache-write column.
    expect(m3!.cacheCreationPricePerMtok).toBeUndefined()
  })

  it('all entries are CNY catalog rows for providerId=minimax', () => {
    expect(MINIMAX_PRICING.length).toBeGreaterThan(0)
    for (const p of MINIMAX_PRICING) {
      expect(p.providerId).toBe('minimax')
      expect(p.currency).toBe('CNY')
      expect(p.source).toBe('catalog')
    }
  })

  it('highspeed variants are priced at 2x the base input/output', () => {
    const base = MINIMAX_PRICING.find((p) => p.model === 'MiniMax-M2.5')!
    const hs = MINIMAX_PRICING.find((p) => p.model === 'MiniMax-M2.5-highspeed')!
    expect(hs.promptPricePerMtok).toBe(base.promptPricePerMtok * 2)
    expect(hs.completionPricePerMtok).toBe(base.completionPricePerMtok * 2)
  })
})
