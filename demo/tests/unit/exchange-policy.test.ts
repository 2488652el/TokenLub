import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ settings: new Map<string, unknown>() }))

vi.mock('../../../code/src/main/store/settings-store', () => ({
  getSetting: (key: string) => state.settings.get(key) ?? null,
  setSetting: (key: string, value: unknown) => state.settings.set(key, value)
}))

import {
  clearExchangeRateCache,
  getCnyRateQuote,
  getPricingExchangePolicy,
  setPricingExchangePolicy
} from '../../../code/src/main/services/exchange-rate'

describe('pricing exchange policy', () => {
  beforeEach(() => {
    state.settings.clear()
    clearExchangeRateCache()
  })

  it('supports offline fallback without calling the network', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    setPricingExchangePolicy({ policy: 'fallback', fixedRates: {} })

    await expect(getCnyRateQuote('USD')).resolves.toMatchObject({
      currency: 'USD',
      rateToCny: expect.any(Number),
      source: 'fallback'
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('uses a persisted fixed rate and returns the normalized policy', async () => {
    setPricingExchangePolicy({ policy: 'fixed', fixedRates: { USD: 7.1234 } })

    await expect(getCnyRateQuote('USD')).resolves.toEqual({
      currency: 'USD',
      rateToCny: 7.1234,
      source: 'fallback'
    })
    expect(getPricingExchangePolicy()).toEqual({
      policy: 'fixed',
      fixedRates: { USD: 7.1234 }
    })
  })
})
