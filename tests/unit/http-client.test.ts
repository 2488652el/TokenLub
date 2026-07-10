/**
 * http-client 单元测试:覆盖 ProviderHttpClient 的 getJSON / postJSON 请求逻辑,
 * 验证 2xx 返回、500 错误、429 重试、x-api-key 鉴权头及 POST 行为。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { ProviderHttpClient } from '../../src/main/providers/http-client'
import { ProviderError } from '@shared/types/provider'

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

// ProviderHttpClient GET 请求行为
describe('ProviderHttpClient', () => {
  it('returns JSON on 2xx', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { ok: true })) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'bearer', token: 't' },
      providerId: 'p'
    })
    const out = await c.getJSON<{ ok: boolean }>('/foo')
    expect(out.ok).toBe(true)
  })

  it('throws ProviderError on 500', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(500, { err: 'x' })) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'bearer', token: 't' },
      providerId: 'p'
    })
    await expect(c.getJSON('/foo')).rejects.toBeInstanceOf(ProviderError)
  })

  it('retries on 429 then succeeds', async () => {
    let i = 0
    globalThis.fetch = vi.fn(async () => {
      i++
      return i < 2 ? jsonResponse(429, {}) : jsonResponse(200, { ok: true })
    }) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'bearer', token: 't' },
      providerId: 'p'
    })
    const out = await c.getJSON<{ ok: boolean }>('/foo')
    expect(out.ok).toBe(true)
  })

  it('uses x-api-key auth header', async () => {
    const seen: Record<string, string> = {}
    globalThis.fetch = vi.fn(async (_url, init) => {
      Object.assign(seen, (init?.headers ?? {}) as Record<string, string>)
      return jsonResponse(200, { ok: true })
    }) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'x-api-key', header: 'x-api-key', token: 't' },
      providerId: 'p'
    })
    await c.getJSON('/foo')
    expect(seen['x-api-key']).toBe('t')
  })
})

// ProviderHttpClient POST 请求行为
describe('ProviderHttpClient.postJSON', () => {
  it('POSTs a JSON body and returns parsed JSON', async () => {
    let seenMethod: string | undefined
    let seenBody: string | undefined
    globalThis.fetch = vi.fn(async (_url, init) => {
      seenMethod = init?.method
      seenBody = typeof init?.body === 'string' ? init.body : undefined
      return jsonResponse(200, { ok: true, content: 'pong' })
    }) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'bearer', token: 't' },
      providerId: 'p'
    })
    const r = await c.postJSON<{ content: string }>('/chat/completions', { max_tokens: 1 })
    expect(seenMethod).toBe('POST')
    expect(seenBody).toBe(JSON.stringify({ max_tokens: 1 }))
    expect(r.content).toBe('pong')
  })

  it('does NOT retry on 429 (chat probes must not auto-retry)', async () => {
    let calls = 0
    globalThis.fetch = vi.fn(async () => {
      calls++
      return jsonResponse(429, { error: 'rate_limited' })
    }) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'bearer', token: 't' },
      providerId: 'p'
    })
    await expect(c.postJSON('/chat/completions', {})).rejects.toThrow()
    expect(calls).toBe(1)
  })

  it('throws ProviderError on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(401, { error: 'unauthorized' })
    ) as typeof fetch
    const c = new ProviderHttpClient({
      baseUrl: 'https://x.test',
      auth: { type: 'bearer', token: 't' },
      providerId: 'p'
    })
    // ProviderError exposes the status as a structured field; the message
    // only includes statusText + body. Check both for robustness.
    let caught: unknown
    try {
      await c.postJSON('/chat/completions', {})
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as { status?: number }).status).toBe(401)
    expect((caught as { code?: string }).code).toBe('HTTP_ERROR')
  })
})
