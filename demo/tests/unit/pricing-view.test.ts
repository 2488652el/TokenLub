import { describe, expect, it } from 'vitest'
import type { PricingEntry } from '../../../code/src/shared/types/pricing'
import {
  filterPricingEntries,
  paginatePricingEntries,
  summarizePricingEntries
} from '../../../code/src/shared/utils/pricing-view'

const entries: PricingEntry[] = [
  {
    providerId: 'openai-admin',
    model: 'gpt-5.2',
    promptPricePerMtok: 2,
    completionPricePerMtok: 8,
    currency: 'USD',
    billingScope: 'global',
    source: 'catalog'
  },
  {
    providerId: 'deepseek',
    model: 'deepseek-chat',
    promptPricePerMtok: 1,
    completionPricePerMtok: 2,
    currency: 'CNY',
    billingScope: 'cn',
    source: 'user'
  },
  {
    providerId: 'openai-admin',
    model: 'gpt-4o',
    promptPricePerMtok: 2.5,
    completionPricePerMtok: 10,
    currency: 'USD',
    source: 'catalog',
    catalogActive: false
  }
]

describe('pricing view helpers', () => {
  it('combines search and structured filters', () => {
    expect(
      filterPricingEntries(entries, {
        providerId: 'openai-admin',
        currency: 'USD',
        billingScope: 'global',
        source: 'catalog',
        query: 'gpt-5'
      })
    ).toEqual([entries[0]])
  })

  it('summarizes catalog health without changing entries', () => {
    expect(summarizePricingEntries(entries)).toEqual({
      total: 3,
      providerCount: 2,
      customCount: 1,
      inactiveCount: 1
    })
  })

  it('clamps pagination to the available range', () => {
    expect(paginatePricingEntries(entries, 9, 2)).toEqual({
      entries: [entries[2]],
      page: 2,
      totalPages: 2
    })
  })
})
