/**
 * NewAPI Generic 供应商单元测试:覆盖 baseUrl 必填校验与配额到 USD 的换算逻辑。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { newapiGenericProvider } from '../../../../code/src/main/providers/newapi-generic'

const realFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = realFetch
})

function jsonResp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

// newapiGenericProvider 测试组:覆盖 baseUrl 必填校验与配额到 USD 的换算
describe('newapiGenericProvider', () => {
  it('throws when no baseUrl is provided', () => {
    expect(() => newapiGenericProvider.build({ baseUrl: '', apiKey: 't' })).toThrow(/baseUrl/)
  })

  it('converts quota to USD using 1 quota = 0.002 USD; total is undefined (OneAPI has no cap)', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResp(200, { id: 1, username: 'alice', role: 1, quota: 1000, used_quota: 500 })
    ) as typeof fetch
    const caps = newapiGenericProvider.build({ baseUrl: 'https://newapi.test', apiKey: 'jwt' })
    const snap = await caps.balance!()
    expect(snap.currency).toBe('USD')
    expect(snap.remaining).toBeCloseTo(2.0, 5) // 1000 * 0.002
    expect(snap.used).toBeCloseTo(1.0, 5) // 500 * 0.002
    expect(snap.total).toBeUndefined() // OneAPI has no fixed cap; we don't fake one
  })
})
