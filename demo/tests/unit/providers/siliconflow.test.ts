/**
 * SiliconFlow 供应商单元测试:覆盖余额读取与非数字字符串容错。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { siliconflowProvider } from '../../../../code/src/main/providers/siliconflow'

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

// siliconflowProvider 测试组:覆盖余额读取与非数字字符串容错
describe('siliconflowProvider', () => {
  it('reads balance from /v1/user/balance', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { data: { balance: '12.5', currency: 'CNY' } })
    ) as typeof fetch
    const caps = siliconflowProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.providerId).toBe('siliconflow')
    expect(snap.remaining).toBe(12.5)
    expect(snap.currency).toBe('CNY')
  })

  it('returns 0 (not NaN) when balance is a non-numeric string', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { data: { balance: 'abc' } })
    ) as typeof fetch
    const caps = siliconflowProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.remaining).toBe(0)
    expect(Number.isNaN(snap.remaining)).toBe(false)
  })
})
