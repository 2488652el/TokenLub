/**
 * Zhipu 供应商单元测试:覆盖余额读取、500 系统异常时 chat 探测回退、多种 baseUrl override 路由与连通性判定。
 * (glm-5.2)
 */
import { describe, expect, it, vi, afterEach } from 'vitest'
import { zhipuProvider } from '../../../../code/src/main/providers/zhipu'

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

// zhipuProvider 测试组:覆盖余额读取、500 异常时 chat 探测回退、baseUrl 路由与连通性判定
describe('zhipuProvider', () => {
  it('reads balance from /api/biz/account/balance when code=200', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        code: 200,
        msg: 'success',
        success: true,
        data: { balance: '12.34', currency: 'CNY' }
      })
    ) as typeof fetch
    const caps = zhipuProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const snap = await caps.balance!()
    expect(snap.providerId).toBe('zhipu')
    expect(snap.remaining).toBe(12.34)
    expect(snap.currency).toBe('CNY')
  })

  it('falls back to chat-completions probe when /api/biz/account/balance returns 500', async () => {
    // Regression: GLM /api/biz/* has been observed to return 500 "系统异常"
    // for valid keys (upstream outage, 2026-07). The provider must NOT mark
    // the key as broken; it should chat-probe and report a friendly message.
    //
    // The probe must hit /api/paas/v4/chat/completions, NOT the platform root
    // (which returns 405). The provider has two http clients: one anchored
    // at the platform root for /api/biz, one at /api/paas/v4 for chat.
    const seen: Array<{ url: string; method: string; body: string }> = []
    globalThis.fetch = vi.fn(async (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      seen.push({
        url,
        method: (init?.method as string) ?? 'GET',
        body: typeof init?.body === 'string' ? init.body : ''
      })
      const u = new URL(url)
      if (u.pathname === '/api/biz/account/balance') {
        return jsonResponse(200, { code: 500, msg: '系统异常', data: null, success: false })
      }
      if (u.pathname === '/api/paas/v4/chat/completions') {
        return jsonResponse(200, {
          choices: [{ message: { content: '' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
        })
      }
      return jsonResponse(404, { error: 'not found' })
    }) as typeof fetch
    const caps = zhipuProvider.build({ baseUrl: '', apiKey: 't' })
    const snap = await caps.balance!()
    const bizHit = seen.find((s) => s.url.endsWith('/api/biz/account/balance'))
    const chatHit = seen.find((s) => s.url.endsWith('/api/paas/v4/chat/completions'))
    expect(bizHit, 'should hit /api/biz/account/balance first').toBeDefined()
    expect(chatHit, 'should fall back to /api/paas/v4/chat/completions').toBeDefined()
    expect(chatHit?.method).toBe('POST')
    expect(chatHit?.body).toMatch(/glm-4.5-flash/)
    // Snapshot has no remaining/total — UI will show "—"
    expect(snap.remaining).toBeUndefined()
    expect(snap.total).toBeUndefined()
    expect((snap.raw as { _probeOnly?: boolean })._probeOnly).toBe(true)
    expect(snap.currency).toBe('CNY')
  })

  it.each([
    ['paas override', 'https://open.bigmodel.cn/api/paas/v4', '/api/paas/v4/chat/completions'],
    [
      'coding openai override',
      'https://open.bigmodel.cn/api/coding/paas/v4',
      '/api/coding/paas/v4/chat/completions'
    ],
    [
      'coding anthropic override',
      'https://open.bigmodel.cn/api/anthropic',
      '/api/coding/paas/v4/chat/completions'
    ],
    ['platform root override', 'https://open.bigmodel.cn', '/api/paas/v4/chat/completions']
  ])(
    'keeps balance on platform root and probes chat correctly for %s',
    async (_label, baseUrl, expectedChatPath) => {
      const seen: string[] = []
      globalThis.fetch = vi.fn(async (input) => {
        const url = typeof input === 'string' ? input : (input as Request).url
        seen.push(url)
        const u = new URL(url)
        if (u.pathname === '/api/biz/account/balance') {
          return jsonResponse(200, { code: 500, msg: '系统异常', data: null, success: false })
        }
        if (u.pathname === expectedChatPath) {
          return jsonResponse(200, { choices: [{ message: { content: '' } }] })
        }
        return jsonResponse(404, { error: 'not found' })
      }) as typeof fetch

      const caps = zhipuProvider.build({ baseUrl, apiKey: 't' })
      const r = await caps.testConnection()

      expect(r.ok).toBe(true)
      expect(seen.some((url) => new URL(url).pathname === '/api/biz/account/balance')).toBe(true)
      expect(seen.some((url) => new URL(url).pathname === expectedChatPath)).toBe(true)
    }
  )

  it('testConnection passes with a clear message when biz is 500 but chat works', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const u = new URL(url)
      if (u.pathname === '/api/biz/account/balance') {
        return jsonResponse(200, { code: 500, msg: '系统异常', data: null, success: false })
      }
      if (u.pathname === '/api/paas/v4/chat/completions') {
        return jsonResponse(200, { choices: [{ message: { content: '' } }] })
      }
      return jsonResponse(404, { error: 'not found' })
    }) as typeof fetch
    const caps = zhipuProvider.build({ baseUrl: '', apiKey: 't' })
    const r = await caps.testConnection()
    expect(r.ok).toBe(true)
    expect(r.message).toMatch(/余额接口|bigmodel\.cn/)
  })

  it('testConnection fails with a clear message when both biz and chat are broken', async () => {
    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url
      const u = new URL(url)
      if (u.pathname === '/api/biz/account/balance') {
        return jsonResponse(200, { code: 401, msg: 'invalid key', data: null, success: false })
      }
      // Both /api/paas/v4 and the platform root return 401
      return jsonResponse(401, { error: { message: 'invalid api key' } })
    }) as typeof fetch
    const caps = zhipuProvider.build({ baseUrl: '', apiKey: 't' })
    const r = await caps.testConnection()
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/401|chat completions 探测/i)
  })

  it('testConnection succeeds on the happy path', async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, { code: 200, msg: 'ok', data: { balance: '5' }, success: true })
    ) as typeof fetch
    const caps = zhipuProvider.build({ baseUrl: 'https://x.test', apiKey: 't' })
    const r = await caps.testConnection()
    expect(r.ok).toBe(true)
    expect(r.message).toBe('Zhipu balance reachable')
  })
})
