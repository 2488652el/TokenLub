import { describe, expect, it } from 'vitest'
import type { PricingEntry } from '../../../code/src/shared/types/pricing'
import {
  dedupePricingToOfficial,
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

describe('dedupePricingToOfficial', () => {
  const catalog = (providerId: string, model: string, billingScope = 'default'): PricingEntry => ({
    providerId,
    model,
    promptPricePerMtok: 1,
    completionPricePerMtok: 2,
    currency: 'USD',
    billingScope,
    source: 'catalog'
  })

  it('keeps only the official row when a model appears under official and aggregators', () => {
    const anthropic = catalog('anthropic-admin', 'claude-opus-4.6')
    const viaOpenrouter = catalog('openrouter', 'claude-opus-4.6')
    const viaSiliconflow = catalog('siliconflow', 'claude-opus-4.6')
    // 乱序输入,验证不依赖出现先后
    const result = dedupePricingToOfficial([viaSiliconflow, anthropic, viaOpenrouter])
    expect(result).toEqual([anthropic])
  })

  it('keeps aggregator-only models that have no official row', () => {
    const official = catalog('deepseek', 'deepseek-chat')
    const aggregatorOnly = catalog('openrouter', 'llama-3-70b')
    const result = dedupePricingToOfficial([official, aggregatorOnly])
    expect(result).toEqual([official, aggregatorOnly])
  })

  it('does not merge different billing scopes of the same model', () => {
    const cn = catalog('moonshot', 'kimi-k2', 'cn')
    const globalScope = catalog('moonshot', 'kimi-k2', 'global')
    const result = dedupePricingToOfficial([cn, globalScope])
    expect(result).toHaveLength(2)
  })

  it('leaves user-defined prices untouched and alongside the official row', () => {
    const official = catalog('deepseek', 'deepseek-chat')
    const viaOpenrouter = catalog('openrouter', 'deepseek-chat')
    const userOverride: PricingEntry = {
      providerId: 'deepseek',
      model: 'deepseek-chat',
      promptPricePerMtok: 9,
      completionPricePerMtok: 9,
      currency: 'CNY',
      billingScope: 'cn',
      source: 'user'
    }
    const result = dedupePricingToOfficial([viaOpenrouter, official, userOverride])
    expect(result).toEqual([official, userOverride])
  })
})
