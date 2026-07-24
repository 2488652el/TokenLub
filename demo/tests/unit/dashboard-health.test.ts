import { describe, expect, it } from 'vitest'
import { buildDashboardHealth } from '../../../code/src/shared/utils/dashboard-health'
import type {
  RefreshAllResult,
  TotalSpendSummary,
  UsageRecord
} from '../../../code/src/shared/types/usage'

function spend(overrides: Partial<TotalSpendSummary> = {}): TotalSpendSummary {
  return {
    total: 8,
    currency: 'CNY',
    byCurrency: [{ currency: 'CNY', amount: 8 }],
    cnyTotal: 8,
    convertedByCurrency: [],
    exchangeRateSource: 'none',
    unconvertedCurrencies: [],
    pricedRequests: 8,
    unpricedRequests: 2,
    totalRequests: 10,
    ...overrides
  }
}

function record(capturedAt: string): UsageRecord {
  return {
    providerId: 'openrouter',
    model: 'openai/gpt-5',
    source: 'vendor-api',
    capturedAt
  }
}

function refresh(overrides: Partial<RefreshAllResult> = {}): RefreshAllResult {
  return {
    started: true,
    queued: 1,
    ok: true,
    refreshed: 1,
    usageInserted: 1,
    usageSkipped: 0,
    failed: 0,
    failures: [],
    ...overrides
  }
}

describe('dashboard health', () => {
  it('returns an empty state when no requests exist', () => {
    expect(buildDashboardHealth(null, [], null)).toEqual({
      coverage: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
      lastCapturedAt: null,
      failedSources: 0,
      tone: 'empty'
    })
  })

  it('reports partial coverage and the latest valid capture time', () => {
    const result = buildDashboardHealth(
      spend(),
      [record('2026-07-20T08:00:00.000Z'), record('invalid'), record('2026-07-21T09:30:00.000Z')],
      refresh()
    )

    expect(result.coverage).toBe(0.8)
    expect(result.lastCapturedAt).toBe('2026-07-21T09:30:00.000Z')
    expect(result.tone).toBe('partial')
  })

  it('reports healthy when every request is priced', () => {
    expect(
      buildDashboardHealth(
        spend({ pricedRequests: 10, unpricedRequests: 0, totalRequests: 10 }),
        [],
        refresh()
      ).tone
    ).toBe('healthy')
  })

  it('prioritizes refresh failures over pricing coverage', () => {
    const result = buildDashboardHealth(
      spend({ pricedRequests: 10, unpricedRequests: 0, totalRequests: 10 }),
      [],
      refresh({ failed: 2 })
    )

    expect(result.failedSources).toBe(2)
    expect(result.tone).toBe('error')
  })
})
