import { describe, expect, it } from 'vitest'
import {
  buildPricingCatalogDiff,
  summarizePricingDiff
} from '../../../code/src/shared/pricing-diff'
import type { PricingEntry } from '../../../code/src/shared/types/pricing'

function price(overrides: Partial<PricingEntry> = {}): PricingEntry {
  return {
    providerId: 'deepseek',
    billingScope: 'default',
    model: 'deepseek-chat',
    promptPricePerMtok: 1,
    completionPricePerMtok: 2,
    currency: 'USD',
    source: 'catalog',
    catalogActive: true,
    ...overrides
  }
}

describe('pricing catalog diff', () => {
  it('detects additions, changes and upstream removals by scoped natural key', () => {
    const changes = buildPricingCatalogDiff(
      [price(), price({ model: 'removed' })],
      [price({ promptPricePerMtok: 1.5 }), price({ model: 'added' })]
    )

    expect(
      changes.map((change) => [change.kind, change.after?.model ?? change.before?.model])
    ).toEqual([
      ['added', 'added'],
      ['changed', 'deepseek-chat'],
      ['removed', 'removed']
    ])
    expect(summarizePricingDiff(changes)).toEqual({ added: 1, changed: 1, removed: 1, blocked: 0 })
  })

  it('blocks a price jump above the configured ratio, including zero-to-nonzero', () => {
    const changes = buildPricingCatalogDiff(
      [price({ promptPricePerMtok: 1 }), price({ model: 'free', promptPricePerMtok: 0 })],
      [price({ promptPricePerMtok: 4 }), price({ model: 'free', promptPricePerMtok: 1 })],
      2
    )

    expect(changes.every((change) => change.blocked)).toBe(true)
    expect(summarizePricingDiff(changes).blocked).toBe(2)
  })

  it('does not compare user overrides as upstream catalog changes', () => {
    const changes = buildPricingCatalogDiff(
      [price({ source: 'user', promptPricePerMtok: 99 })],
      [price({ promptPricePerMtok: 1.5 })]
    )

    expect(changes).toEqual([expect.objectContaining({ kind: 'added', blocked: false })])
  })
})
