/**
 * DeepSeek 供应商单元测试:覆盖余额接口解析与连通性测试。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { deepseekProvider } from '../../../../code/src/main/providers/deepseek'

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

// deepseekProvider 测试组:覆盖余额读取、hasUsageApi 回归守卫与空数据容错
describe('deepseekProvider', () => {
  it('reads balance from /user/balance', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        is_available: true,
        balance_infos: [{ currency: 'CNY', total_balance: '66.6' }]
      })
    ) as typeof fetch
    const caps = deepseekProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.providerId).toBe('deepseek')
    expect(snap.total).toBe(66.6)
    expect(snap.currency).toBe('CNY')
  })

  it('does NOT advertise a usage API (N1: hasUsageApi must be false — no usage() exists)', () => {
    // Regression guard: previously hasUsageApi was true without a usage() impl,
    // which would crash any caller iterating providers by hasUsageApi. This is
    // the same bug class as the original OpenRouter finding (phase-d #1).
    expect(deepseekProvider.hasUsageApi).toBe(false)
    expect(deepseekProvider.manifest.features).not.toContain('usage')

    const caps = deepseekProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    expect(caps.usage).toBeUndefined()
  })

  it('handles empty balance_infos gracefully', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { is_available: true, balance_infos: [] })
    ) as typeof fetch
    const caps = deepseekProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.total).toBe(0)
  })
})
