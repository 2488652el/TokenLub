/**
 * Moonshot 供应商单元测试:覆盖余额读取、404 回退备用接口与海外端点货币判定。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { moonshotProvider } from '../../../../code/src/main/providers/moonshot'

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

// moonshotProvider 测试组:覆盖余额读取、404 回退 credit_grants 与海外端点 USD 货币判定
describe('moonshotProvider', () => {
  it('reads balance from /v1/users/me/balance', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { remaining: 50, total: 100, data: { currency: 'CNY' } })
    ) as typeof fetch
    const caps = moonshotProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.providerId).toBe('moonshot')
    expect(snap.remaining).toBe(50)
    expect(snap.total).toBe(100)
    expect(snap.currency).toBe('CNY')
  })

  it('falls back to /v1/dashboard/billing/credit_grants when /v1/users/me/balance 404s', async () => {
    let i = 0
    globalThis.fetch = vi.fn(async () => {
      i++
      if (i === 1) return new Response('Not Found', { status: 404 })
      return jsonResponse(200, { total_available: 80, total_granted: 200 })
    }) as typeof fetch
    const caps = moonshotProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.remaining).toBe(80)
    expect(snap.total).toBe(200)
  })

  it('labels overseas endpoint api.moonshot.ai with USD currency', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { remaining: 5.2, total: 50 })
    ) as typeof fetch
    const caps = moonshotProvider.build({ baseUrl: 'https://api.moonshot.ai', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.currency).toBe('USD')
  })
})
