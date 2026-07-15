/** 人民币汇率查询的缓存、实时结果与离线回退测试。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearExchangeRateCache, getCnyRateQuote } from '../../src/main/services/exchange-rate'
import { DEFAULT_CNY_RATES } from '../../src/shared/utils/money'

const realFetch = globalThis.fetch

beforeEach(() => clearExchangeRateCache())
afterEach(() => {
  globalThis.fetch = realFetch
  clearExchangeRateCache()
})

describe('getCnyRateQuote', () => {
  it('returns and caches a live USD/CNY quote', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: 200, rate: '7.2', uptime: '2026-07-15 12:00:00' }), {
          status: 200
        })
    ) as typeof fetch

    await expect(getCnyRateQuote('usd')).resolves.toEqual({
      currency: 'USD',
      rateToCny: 7.2,
      source: 'api',
      updatedAt: '2026-07-15 12:00:00'
    })
    await getCnyRateQuote('USD')
    expect(globalThis.fetch).toHaveBeenCalledTimes(1)
  })

  it('falls back when the exchange API is unavailable', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('offline')
    }) as typeof fetch
    await expect(getCnyRateQuote('USD')).resolves.toEqual({
      currency: 'USD',
      rateToCny: DEFAULT_CNY_RATES.USD,
      source: 'fallback'
    })
  })

  it('returns identity for CNY without a network request', async () => {
    globalThis.fetch = vi.fn()
    await expect(getCnyRateQuote('CNY')).resolves.toEqual({
      currency: 'CNY',
      rateToCny: 1,
      source: 'fallback'
    })
    expect(globalThis.fetch).not.toHaveBeenCalled()
  })
})
