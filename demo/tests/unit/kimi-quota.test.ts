import { describe, expect, it } from 'vitest'
import { extractKimiCodingQuotas } from '../../../code/src/shared/utils/kimi-quota'

describe('extractKimiCodingQuotas', () => {
  it('normalizes the Kimi Code usage response', () => {
    const quotas = extractKimiCodingQuotas({
      usage: { limit: '1000', used: '250', remaining: '750', resetTime: '2026-07-24T00:00:00Z' },
      limits: [
        {
          window: { duration: 5, timeUnit: 'TIME_UNIT_HOUR' },
          detail: { limit: 100, remaining: 60, reset_at: '2026-07-17T15:00:00Z' }
        }
      ]
    })
    expect(quotas.weeklyWindow).toEqual({
      label: '7d',
      usedPercent: 25,
      remainingText: '剩余 75%',
      resetText: '重置 2026-07-24T00:00:00Z'
    })
    expect(quotas.rateWindow).toEqual({
      label: '5h',
      usedPercent: 40,
      remainingText: '剩余 60%',
      resetText: '重置 2026-07-17T15:00:00Z'
    })
  })
})
