import { beforeEach, describe, expect, it, vi } from 'vitest'

type StoredPrice = {
  providerId: string
  billingScope: string
  model: string
  currency: string
  source: 'catalog' | 'user'
  catalogActive: number
}

const state = vi.hoisted(() => ({
  prices: [] as StoredPrice[],
  dirtyCalls: 0
}))

const db = {
  prepare(sql: string) {
    return {
      run: (...args: unknown[]) => {
        if (sql.includes('SET catalog_active = 0')) {
          const [, providerId, billingScope] = args as [string, string, string]
          let changes = 0
          for (const price of state.prices) {
            if (
              price.source === 'catalog' &&
              price.providerId === providerId &&
              price.billingScope === billingScope
            ) {
              price.catalogActive = 0
              changes++
            }
          }
          return { changes }
        }

        if (sql.includes('INSERT INTO pricing_entries')) {
          const providerId = String(args[0])
          const billingScope = String(args[1])
          const model = String(args[2])
          const currency = String(args[7])
          const existing = state.prices.find(
            (price) =>
              price.providerId === providerId &&
              price.billingScope === billingScope &&
              price.model === model &&
              price.currency === currency
          )
          if (existing?.source === 'user') return { changes: 0 }
          if (existing) {
            existing.catalogActive = 1
          } else {
            state.prices.push({
              providerId,
              billingScope,
              model,
              currency,
              source: 'catalog',
              catalogActive: 1
            })
          }
          return { changes: 1 }
        }

        return { changes: 1 }
      }
    }
  },
  transaction<T, A extends unknown[]>(run: (...args: A) => T) {
    return (...args: A) => run(...args)
  }
}

vi.mock('../../../../code/src/main/store/db', () => ({ getDb: () => db }))
vi.mock('../../../../code/src/main/store/sync-v2-repo', () => ({
  markSyncV2Dirty: () => state.dirtyCalls++
}))

import { upsertCatalogBatch } from '../../../../code/src/main/store/pricing-repo'

describe('pricing repository catalog lifecycle', () => {
  beforeEach(() => {
    state.dirtyCalls = 0
    state.prices = [
      {
        providerId: 'moonshot',
        billingScope: 'global',
        model: 'kept-model',
        currency: 'USD',
        source: 'catalog',
        catalogActive: 1
      },
      {
        providerId: 'moonshot',
        billingScope: 'global',
        model: 'removed-model',
        currency: 'USD',
        source: 'catalog',
        catalogActive: 1
      },
      {
        providerId: 'minimax',
        billingScope: 'cn',
        model: 'MiniMax-M2.1',
        currency: 'CNY',
        source: 'catalog',
        catalogActive: 1
      },
      {
        providerId: 'moonshot',
        billingScope: 'global',
        model: 'custom-model',
        currency: 'USD',
        source: 'user',
        catalogActive: 1
      }
    ]
  })

  it('reactivates current rows, marks missing managed rows inactive, and preserves other scopes', () => {
    const result = upsertCatalogBatch(
      [
        {
          providerId: 'moonshot',
          billingScope: 'global',
          model: 'kept-model',
          promptPricePerMtok: 1,
          completionPricePerMtok: 2,
          currency: 'USD',
          source: 'catalog'
        }
      ],
      {
        deactivateMissing: true,
        managedScopes: [
          { providerId: 'moonshot', billingScope: 'global' },
          { providerId: 'deepseek', billingScope: 'default' }
        ]
      }
    )

    expect(result).toEqual({ updated: 1, skipped: 0 })
    expect(state.prices.find((price) => price.model === 'kept-model')?.catalogActive).toBe(1)
    expect(state.prices.find((price) => price.model === 'removed-model')?.catalogActive).toBe(0)
    expect(state.prices.find((price) => price.billingScope === 'cn')?.catalogActive).toBe(1)
    expect(state.prices.find((price) => price.source === 'user')?.catalogActive).toBe(1)
    expect(state.dirtyCalls).toBe(1)
  })

  it('does not overwrite a user-owned natural key', () => {
    const result = upsertCatalogBatch([
      {
        providerId: 'moonshot',
        billingScope: 'global',
        model: 'custom-model',
        promptPricePerMtok: 99,
        completionPricePerMtok: 99,
        currency: 'USD',
        source: 'catalog'
      }
    ])

    expect(result).toEqual({ updated: 0, skipped: 1 })
    expect(state.prices.find((price) => price.model === 'custom-model')?.source).toBe('user')
    expect(state.dirtyCalls).toBe(0)
  })
})
