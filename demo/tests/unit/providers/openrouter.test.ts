/**
 * OpenRouter 供应商单元测试:覆盖余额读取与 hasUsageApi 回归守卫。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { openrouterProvider } from '../../../../code/src/main/providers/openrouter'

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

// openrouterProvider 测试组:覆盖余额读取与 hasUsageApi 回归守卫
describe('openrouterProvider', () => {
  it('reads balance from /auth/key', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { data: { limit: 100, limit_remaining: 75, usage: 25 } })
    ) as typeof fetch
    const caps = openrouterProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.providerId).toBe('openrouter')
    expect(snap.remaining).toBe(75)
    expect(snap.total).toBe(100)
    expect(snap.used).toBe(25)
    expect(snap.currency).toBe('USD')
  })

  it('does NOT advertise a usage API (hasUsageApi false — no usage() exists)', () => {
    // Regression guard: features advertised 'usage' while hasUsageApi was false
    // and build() returned no usage() — same bug class as the DeepSeek N1 fix.
    expect(openrouterProvider.hasUsageApi).toBe(false)
    expect(openrouterProvider.manifest.features).not.toContain('usage')
    const caps = openrouterProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    expect(caps.usage).toBeUndefined()
  })
})
