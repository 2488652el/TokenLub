/**
 * OpenAI Admin 供应商单元测试:覆盖 Bearer 鉴权选择、cost_report 余额求和与 usage 时间戳解析。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { openaiAdminProvider } from '../../../src/main/providers/openai-admin'

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

// openaiAdminProvider 测试组:覆盖 Bearer 鉴权选择、余额求和与用量时间戳解析
describe('openaiAdminProvider', () => {
  it('uses Bearer auth from creds.apiKey or extra.adminKey', async () => {
    const seen: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (_u, init) => {
      Object.assign(seen, (init?.headers ?? {}) as Record<string, string>)
      return jsonResp(200, { data: [] })
    }) as typeof fetch
    const caps = openaiAdminProvider.build({
      baseUrl: 'https://x.test',
      apiKey: 'sk-regular',
      extra: { adminKey: 'sk-admin-y' }
    })
    await caps.balance!()
    expect(seen['Authorization']).toBe('Bearer sk-admin-y')
  })

  it('balance sums cost report amounts', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResp(200, {
        data: [
          {
            results: [
              { amount: { value: 12.5, currency: 'usd' } },
              { amount: { value: 7.25, currency: 'usd' } }
            ]
          }
        ]
      })
    ) as typeof fetch
    const caps = openaiAdminProvider.build({ baseUrl: 'https://x.test', apiKey: 'k' })
    const snap = await caps.balance!()
    expect(snap.used).toBeCloseTo(19.75, 5)
    expect(snap.currency).toBe('USD')
  })

  it('usage parses start_time/end_time as unix seconds', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResp(200, {
        data: [
          {
            start_time: 1751328000, // 2025-07-01
            end_time: 1751414400,
            results: [
              {
                object: 'a',
                model: 'gpt-4o',
                input_tokens: 100,
                output_tokens: 50,
                num_model_requests: 1
              }
            ]
          }
        ]
      })
    ) as typeof fetch
    const caps = openaiAdminProvider.build({ baseUrl: 'https://x.test', apiKey: 'k' })
    const slices = await caps.usage!('2025-07-01T00:00:00Z', '2025-07-02T00:00:00Z')
    expect(slices[0]?.model).toBe('gpt-4o')
    expect(slices[0]?.promptTokens).toBe(100)
  })
})
