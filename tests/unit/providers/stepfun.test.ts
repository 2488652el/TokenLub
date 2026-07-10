/**
 * StepFun 供应商单元测试:覆盖余额读取与非数字占位符容错。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { stepfunProvider } from '../../../src/main/providers/stepfun'

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

// stepfunProvider 测试组:覆盖余额读取与非数字占位符容错
describe('stepfunProvider', () => {
  it('reads balance from /v1/account/balance', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 0,
        data: { balance: '88.0', total_balance: '100.0', currency: 'CNY' }
      })
    ) as typeof fetch
    const caps = stepfunProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.providerId).toBe('stepfun')
    expect(snap.remaining).toBe(88)
    expect(snap.total).toBe(100)
    expect(snap.currency).toBe('CNY')
  })

  it('returns 0 (not NaN) for non-numeric placeholder strings', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { code: 0, data: { balance: 'N/A', total_balance: '-' } })
    ) as typeof fetch
    const caps = stepfunProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.remaining).toBe(0)
    expect(snap.total).toBe(0)
    expect(Number.isNaN(snap.remaining)).toBe(false)
    expect(Number.isNaN(snap.total)).toBe(false)
  })
})
