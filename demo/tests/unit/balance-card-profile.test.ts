import { describe, expect, it } from 'vitest'
import { getBalanceCardProfile } from '../../../code/src/shared/utils/balance-card-profile'

const apiKey = {
  source: 'api-key' as const
}

describe('getBalanceCardProfile', () => {
  it('distinguishes Kimi API from Kimi Coding Plan', () => {
    expect(getBalanceCardProfile({ ...apiKey, providerId: 'moonshot' })).toBe('api-balance')
    expect(getBalanceCardProfile({ ...apiKey, providerId: 'kimi-coding' })).toBe('coding-plan')
  })

  it('uses the configured Zhipu endpoint to distinguish API and Coding Plan keys', () => {
    expect(getBalanceCardProfile({ ...apiKey, providerId: 'zhipu' })).toBe('api-balance')
    expect(
      getBalanceCardProfile({
        ...apiKey,
        providerId: 'zhipu',
        baseUrlOverride: 'https://open.bigmodel.cn/api/coding/paas/v4'
      })
    ).toBe('coding-plan')
    expect(
      getBalanceCardProfile({
        ...apiKey,
        providerId: 'zhipu',
        baseUrlOverride: 'https://open.bigmodel.cn/api/anthropic'
      })
    ).toBe('coding-plan')
  })

  it('keeps token packs, gateways and manual balances visually distinct', () => {
    expect(getBalanceCardProfile({ ...apiKey, providerId: 'longcat' })).toBe('token-pack')
    expect(getBalanceCardProfile({ ...apiKey, providerId: 'openrouter' })).toBe('gateway')
    expect(
      getBalanceCardProfile({
        providerId: 'gemini-manual',
        source: 'manual'
      })
    ).toBe('manual')
  })
})
