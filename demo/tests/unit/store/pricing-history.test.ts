import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PricingDiffEntry } from '../../../../code/src/shared/types/pricing'

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  inserts: [] as unknown[][]
}))

const db = {
  prepare(sql: string) {
    return {
      run: (...args: unknown[]) => {
        if (sql.includes('INSERT INTO pricing_change_history')) state.inserts.push(args)
        return { changes: 1 }
      },
      all: () => state.rows
    }
  },
  transaction<T>(run: (rows: PricingDiffEntry[]) => T) {
    return (rows: PricingDiffEntry[]) => run(rows)
  }
}

vi.mock('../../../../code/src/main/store/db', () => ({ getDb: () => db }))
vi.mock('../../../../code/src/main/store/sync-v2-repo', () => ({ markSyncV2Dirty: vi.fn() }))

import {
  listPricingHistory,
  recordPricingHistory
} from '../../../../code/src/main/store/pricing-repo'

describe('pricing history repository', () => {
  beforeEach(() => {
    state.rows = []
    state.inserts = []
  })

  it('records before/after snapshots and maps history rows', () => {
    const before = {
      providerId: 'moonshot',
      billingScope: 'global',
      model: 'kimi-test',
      promptPricePerMtok: 1,
      completionPricePerMtok: 2,
      currency: 'USD',
      source: 'catalog' as const
    }
    const after = { ...before, promptPricePerMtok: 2 }
    const change: PricingDiffEntry = {
      key: 'moonshot:global:kimi-test:USD',
      kind: 'changed',
      before,
      after,
      changeRatio: 1,
      blocked: false
    }

    recordPricingHistory(
      [change],
      'applied',
      '2026-07-15T00:00:00.000Z',
      '2026-07-15T00:01:00.000Z'
    )
    expect(state.inserts[0]).toEqual([
      'moonshot',
      'global',
      'kimi-test',
      'USD',
      'changed',
      JSON.stringify(before),
      JSON.stringify(after),
      1,
      'applied',
      '2026-07-15T00:00:00.000Z',
      '2026-07-15T00:01:00.000Z'
    ])

    state.rows = [
      {
        id: 1,
        provider_id: 'moonshot',
        billing_scope: 'global',
        model: 'kimi-test',
        currency: 'USD',
        change_kind: 'changed',
        before_json: JSON.stringify(before),
        after_json: JSON.stringify(after),
        change_ratio: 1,
        status: 'applied',
        detected_at: '2026-07-15T00:00:00.000Z',
        applied_at: '2026-07-15T00:01:00.000Z'
      }
    ]
    expect(listPricingHistory(8)[0]).toMatchObject({
      id: 1,
      providerId: 'moonshot',
      billingScope: 'global',
      kind: 'changed',
      before,
      after,
      status: 'applied'
    })
  })
})
