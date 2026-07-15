import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/main/store/db', () => ({
  getDb: () => ({
    prepare: () => ({
      all: () => [
        { key: 'refresh_interval_min', value: '30' },
        { key: 'pricing_catalog_last_attempt_at', value: '"internal"' },
        { key: 'pricing_exchange_policy', value: '"fixed"' }
      ]
    })
  })
}))
vi.mock('../../../src/main/store/sync-v2-repo', () => ({ markSyncV2Dirty: vi.fn() }))

import { getAllSettings } from '../../../src/main/store/settings-store'

describe('settings visibility', () => {
  it('does not expose pricing service metadata through the generic settings API', () => {
    expect(getAllSettings()).toEqual({ refresh_interval_min: 30 })
  })
})
