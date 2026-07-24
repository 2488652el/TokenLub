import { describe, expect, it } from 'vitest'
import {
  readUsageAnalysisFilter,
  usageRangeToLocalDates,
  USAGE_ANALYSIS_FILTER_STORAGE_KEY,
  writeUsageAnalysisFilter
} from '../../../code/src/shared/utils/usage-analysis-filter'
import { DASHBOARD_RANGE_STORAGE_KEY } from '../../../code/src/shared/utils/dashboard-range'

function memoryStorage(entries: Record<string, string> = {}) {
  const values = new Map(Object.entries(entries))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    values
  }
}

describe('shared usage analysis filter', () => {
  it('migrates the legacy dashboard range and rejects invalid persisted values', () => {
    const storage = memoryStorage({
      [DASHBOARD_RANGE_STORAGE_KEY]: '7d',
      [USAGE_ANALYSIS_FILTER_STORAGE_KEY]: JSON.stringify({
        range: 'invalid',
        source: 'invalid',
        modelContains: 42
      })
    })

    expect(readUsageAnalysisFilter(storage)).toEqual({
      range: '7d',
      source: 'all',
      modelContains: '',
      projectContains: ''
    })
  })

  it('persists the shared filter and keeps the legacy range key synchronized', () => {
    const storage = memoryStorage()
    const filter = {
      range: 'today' as const,
      source: 'session-log' as const,
      modelContains: 'gpt',
      projectContains: 'tokenlub'
    }

    writeUsageAnalysisFilter(storage, filter)

    expect(readUsageAnalysisFilter(storage)).toEqual(filter)
    expect(storage.values.get(DASHBOARD_RANGE_STORAGE_KEY)).toBe('today')
  })

  it('converts a 7-day range to inclusive local date inputs', () => {
    expect(usageRangeToLocalDates('7d', new Date(2026, 6, 24, 12))).toEqual({
      from: '2026-07-18',
      to: '2026-07-24'
    })
  })
})
