/**
 * 用量概览周期持久化测试:覆盖合法值恢复、无效值回退与存储异常降级。
 */
import { describe, expect, it, vi } from 'vitest'
import {
  DASHBOARD_RANGE_STORAGE_KEY,
  readDashboardRange,
  writeDashboardRange
} from '../../../code/src/shared/utils/dashboard-range'

describe('dashboard range persistence', () => {
  it.each(['today', '7d', '30d', 'all'] as const)('restores the saved %s range', (range) => {
    const storage = {
      getItem: vi.fn(() => range),
      setItem: vi.fn()
    }

    expect(readDashboardRange(storage)).toBe(range)
    expect(storage.getItem).toHaveBeenCalledWith(DASHBOARD_RANGE_STORAGE_KEY)
  })

  it.each([null, '', 'week', '90d'])('falls back to 30d for invalid value %s', (stored) => {
    const storage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn()
    }

    expect(readDashboardRange(storage)).toBe('30d')
  })

  it('falls back to 30d when storage cannot be read', () => {
    const storage = {
      getItem: vi.fn(() => {
        throw new Error('storage unavailable')
      }),
      setItem: vi.fn()
    }

    expect(readDashboardRange(storage)).toBe('30d')
  })

  it('saves the selected range and ignores storage write failures', () => {
    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn()
    }

    writeDashboardRange(storage, '7d')
    expect(storage.setItem).toHaveBeenCalledWith(DASHBOARD_RANGE_STORAGE_KEY, '7d')

    storage.setItem.mockImplementation(() => {
      throw new Error('storage unavailable')
    })
    expect(() => writeDashboardRange(storage, 'today')).not.toThrow()
  })
})
