import { afterEach, describe, expect, it, vi } from 'vitest'
import { kimiCodingProvider } from '../../../../code/src/main/providers/kimi-coding'

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

describe('kimiCodingProvider', () => {
  it('reads weekly and rolling quota from /usages', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.kimi.com/coding/v1/usages')
      return jsonResponse(200, {
        usage: { limit: '1000', used: '250', remaining: '750', resetTime: '2026-07-24T00:00:00Z' },
        limits: [
          {
            window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
            detail: { limit: 100, used: 40, remaining: 60, resetTime: '2026-07-17T15:00:00Z' }
          }
        ]
      })
    }) as typeof fetch

    const snap = await kimiCodingProvider.build({ baseUrl: '', apiKey: 't' }).balance?.()
    expect(snap?.providerId).toBe('kimi-coding')
    expect(snap?.remaining).toBe(75)
    expect(snap?.used).toBe(25)
    expect(snap?.total).toBe(100)
    expect(snap?.currency).toBe('PERCENT')
  })

  it('validates a key through the zero-cost models endpoint', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.kimi.com/coding/v1/models')
      return jsonResponse(200, { data: [{ id: 'kimi-for-coding' }] })
    }) as typeof fetch
    const result = await kimiCodingProvider
      .build({ baseUrl: 'https://api.kimi.com/coding/v1', apiKey: 't' })
      .testConnection()
    expect(result.ok).toBe(true)
  })

  it('normalizes the Anthropic-compatible base URL before quota probing', async () => {
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('https://api.kimi.com/coding/v1/usages')
      return jsonResponse(200, { usage: { limit: 10, remaining: 10 } })
    }) as typeof fetch
    await kimiCodingProvider
      .build({ baseUrl: 'https://api.kimi.com/coding/', apiKey: 't' })
      .balance?.()
  })
})
