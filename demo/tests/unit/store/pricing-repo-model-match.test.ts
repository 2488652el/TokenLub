import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  all: vi.fn()
}))

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: () => ({
    prepare: () => ({ all: state.all })
  })
}))

vi.mock('../../../../code/src/main/store/sync-v2-repo', () => ({
  markSyncV2Dirty: vi.fn()
}))

import { findPricingByModel } from '../../../../code/src/main/store/pricing-repo'

const row = {
  id: 1,
  provider_id: 'openrouter',
  billing_scope: 'default',
  model: 'moonshotai/kimi-k3',
  prompt_price_per_mtok: 3,
  completion_price_per_mtok: 15,
  cache_read_price_per_mtok: 0.3,
  cache_creation_price_per_mtok: null,
  currency: 'USD',
  source: 'catalog',
  catalog_active: 1,
  updated_at: '2026-07-20T00:00:00.000Z'
}

describe('pricing repository model fallback matching', () => {
  beforeEach(() => {
    state.all.mockReset()
    state.all.mockReturnValue([row])
  })

  it.each([
    ['MiniMax-M3', 'minimax-m3', '%/minimax-m3'],
    ['grok-4.5', 'grok-4.5', '%/grok-4.5'],
    ['kimi-code/kimi-k2.7-code', 'kimi-k2.7-code', '%/kimi-k2.7-code'],
    ['k3', 'kimi-k3', '%/kimi-k3']
  ])('matches catalog variants for %s', (model, canonicalModel, suffixPattern) => {
    expect(findPricingByModel(model, 'USD', 'default')).toMatchObject({
      providerId: 'openrouter',
      model: 'moonshotai/kimi-k3'
    })
    expect(state.all).toHaveBeenCalledWith(
      'default',
      model,
      model.toLowerCase(),
      canonicalModel,
      suffixPattern,
      model,
      model.toLowerCase(),
      canonicalModel,
      'default',
      'USD'
    )
  })

  it('returns null when no exact or canonical model price exists', () => {
    state.all.mockReturnValue([])
    expect(findPricingByModel('unknown-model')).toBeNull()
  })
})
