/**
 * Anthropic Admin 供应商单元测试:覆盖鉴权头构造、cost_report 余额求和与 bucketed usage 扁平化。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { anthropicAdminProvider } from '../../../src/main/providers/anthropic-admin'

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

// anthropicAdminProvider 测试组:覆盖鉴权头、余额解析与用量扁平化
describe('anthropicAdminProvider', () => {
  it('sends x-api-key + anthropic-version + anthropic-beta headers', async () => {
    const captured: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (_url, init) => {
      Object.assign(captured, (init?.headers ?? {}) as Record<string, string>)
      return jsonResp(200, { data: [] })
    }) as typeof fetch
    const caps = anthropicAdminProvider.build({
      baseUrl: 'https://x.test',
      apiKey: 'sk-ant-admin-x'
    })
    await caps.balance!()
    expect(captured['x-api-key']).toBe('sk-ant-admin-x')
    expect(captured['anthropic-version']).toBe('2023-06-01')
    expect(captured['anthropic-beta']).toContain('usage-cost-api-2025-05-20')
  })

  it('reads cost_report and sums amounts', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResp(200, { data: [{ results: [{ amount: '10.5' }, { amount: '4.25' }] }] })
    ) as typeof fetch
    const caps = anthropicAdminProvider.build({ baseUrl: 'https://x.test', apiKey: 'k' })
    const snap = await caps.balance!()
    expect(snap.used).toBeCloseTo(14.75, 5)
    expect(snap.currency).toBe('USD')
  })

  it('usage() flattens bucketed results', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResp(200, {
        data: [
          {
            starting_at: '2026-07-01T00:00:00Z',
            ending_at: '2026-07-02T00:00:00Z',
            results: [{ input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 5 }]
          }
        ]
      })
    ) as typeof fetch
    const caps = anthropicAdminProvider.build({ baseUrl: 'https://x.test', apiKey: 'k' })
    const slices = await caps.usage!('2026-07-01T00:00:00Z', '2026-07-02T00:00:00Z')
    expect(slices).toHaveLength(1)
    expect(slices[0]?.promptTokens).toBe(100)
    expect(slices[0]?.cacheCreationTokens).toBe(5)
  })
})
