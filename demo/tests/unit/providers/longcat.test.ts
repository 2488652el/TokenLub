/**
 * LongCat 供应商单元测试:覆盖 baseUrl 归一化、OpenAI 兼容连通性探测与平台 Cookie 令牌包余额读取。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { longcatProvider } from '../../../../code/src/main/providers/longcat'

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

// longcatProvider 测试组:覆盖无 Cookie 时余额缺失、baseUrl 归一化与平台 Cookie 令牌包余额
describe('longcatProvider', () => {
  it('does not expose balance without a platform cookie', () => {
    const caps = longcatProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    expect(longcatProvider.hasBalanceApi).toBe(true)
    expect(caps.balance).toBeUndefined()
  })

  it('tests connection through /openai/v1/models (LongCat is OpenAI-compatible)', async () => {
    let requestedPath: string | undefined
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      requestedPath = new URL(url).pathname
      return jsonResp(200, { data: [] })
    }) as typeof fetch
    const caps = longcatProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const result = await caps.testConnection()
    expect(requestedPath).toBe('/openai/v1/models')
    expect(result.ok).toBe(true)
  })

  it('does not duplicate /openai when the saved baseUrl already includes it', async () => {
    let requestedPath: string | undefined
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      requestedPath = new URL(url).pathname
      return jsonResp(200, { data: [] })
    }) as typeof fetch
    const caps = longcatProvider.build({ baseUrl: 'https://api.longcat.chat/openai', apiKey: 't' })
    await caps.testConnection()
    expect(requestedPath).toBe('/openai/v1/models')
  })

  it('normalizes an Anthropic-compatible saved baseUrl before testing OpenAI models', async () => {
    let requestedUrl: string | undefined
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      requestedUrl = url
      return jsonResp(200, { data: [] })
    }) as typeof fetch
    const caps = longcatProvider.build({
      baseUrl: 'https://api.longcat.chat/anthropic',
      apiKey: 't'
    })
    await caps.testConnection()
    expect(requestedUrl).toBe('https://api.longcat.chat/openai/v1/models')
  })

  it('reads token pack balance with the encrypted platform cookie', async () => {
    const seen: Array<{ url: string; method: string; cookie: string | null; body: string | null }> =
      []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      seen.push({
        url,
        method: init?.method ?? 'GET',
        cookie: new Headers(init?.headers).get('cookie'),
        body: typeof init?.body === 'string' ? init.body : null
      })
      return jsonResp(200, {
        code: 0,
        msg: 'success',
        data: {
          currentLot: {
            remainingToken: 9_267_082,
            totalToken: 10_000_000,
            consumedToken: 732_918,
            consumedRatio: 0.0732918,
            expireTime: '2026-07-31 12:45:55'
          },
          estimate: { dailyAverageToken: 0, exhaustedAfterDays: 0, windowDays: 7 }
        }
      })
    }) as typeof fetch
    const caps = longcatProvider.build({
      baseUrl: 'https://api.longcat.chat',
      apiKey: 't',
      extra: { longcatPlatformCookie: 'passport_token_key=secret; long_cat_region_key=0' }
    })
    const snap = await caps.balance!()
    expect(seen[0]).toMatchObject({
      url: 'https://longcat.chat/api/pay/quota/metering/token-packs/summary',
      method: 'POST',
      cookie: 'passport_token_key=secret; long_cat_region_key=0',
      body: '{}'
    })
    expect(snap).toMatchObject({
      providerId: 'longcat',
      remaining: 9_267_082,
      total: 10_000_000,
      used: 732_918,
      currency: 'TOKENS'
    })
  })
})
