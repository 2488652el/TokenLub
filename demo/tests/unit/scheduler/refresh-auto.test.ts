/**
 * 调度器自动刷新定时器单元测试:覆盖 startAutoRefresh / restartAutoRefresh,
 * 校验间隔设置生效与重启后旧定时器被取消、新间隔生效。
 * (glm-5.2)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSetting, setSetting } from '../../../../code/src/main/store/settings-store'

vi.mock('../../../../code/src/main/store/settings-store', () => ({
  getSetting: vi.fn(),
  setSetting: vi.fn()
}))

vi.mock('../../../../code/src/main/store/keys-repo', () => ({
  listKeys: vi.fn(() => []),
  getDecryptedKey: vi.fn(),
  getDecryptedExtraCredentials: vi.fn()
}))

vi.mock('../../../../code/src/main/store/balance-repo', () => ({
  insertBalance: vi.fn(),
  latestBalances: vi.fn(() => [])
}))

vi.mock('../../../../code/src/main/store/usage-repo', () => ({
  insertUsage: vi.fn(() => ({ inserted: 0, skipped: 0 }))
}))

vi.mock('../../../../code/src/main/store/pricing-repo', () => ({
  findPricing: vi.fn()
}))

vi.mock('../../../../code/src/main/store/alerts-repo', () => ({
  listAlerts: vi.fn(() => []),
  markAlertTriggered: vi.fn(),
  insertAlertEvent: vi.fn()
}))

vi.mock('../../../../code/src/main/store/db', () => ({
  getDb: vi.fn()
}))

vi.mock('../../../../code/src/main/providers/registry', () => ({
  getProvider: vi.fn()
}))

// 调度器自动刷新定时器:校验间隔生效与重启换间隔
describe('scheduler auto-refresh timer', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getSetting).mockReturnValue(30)
  })

  afterEach(async () => {
    // Stop any running timer by restarting with interval disabled.
    vi.mocked(getSetting).mockReturnValue(0)
    const { restartAutoRefresh } = await import('../../../../code/src/main/scheduler/refresh')
    restartAutoRefresh()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('startAutoRefresh respects refresh_interval_min setting', async () => {
    vi.mocked(getSetting).mockReturnValue(15)
    const { startAutoRefresh } = await import('../../../../code/src/main/scheduler/refresh')

    startAutoRefresh()

    // Should not fire immediately.
    expect(setSetting).not.toHaveBeenCalledWith('last_refresh_at', expect.any(String))

    // Advance 15 minutes: first refresh fires.
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(setSetting).toHaveBeenCalledWith('last_refresh_at', expect.any(String))

    // Advance another 15 minutes: second refresh fires on schedule.
    vi.mocked(setSetting).mockClear()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)
    expect(setSetting).toHaveBeenCalledWith('last_refresh_at', expect.any(String))
  })

  it('restartAutoRefresh stops old timer and starts new one with updated interval', async () => {
    vi.mocked(getSetting).mockReturnValue(60)
    const { startAutoRefresh, restartAutoRefresh } =
      await import('../../../../code/src/main/scheduler/refresh')

    startAutoRefresh()

    // With a 60-minute interval, 30 minutes should not trigger a refresh.
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(setSetting).not.toHaveBeenCalledWith('last_refresh_at', expect.any(String))

    // Update setting and restart: old timer must be cancelled and new interval used.
    vi.mocked(getSetting).mockReturnValue(5)
    restartAutoRefresh()

    // New 5-minute timer fires after 5 minutes, not the leftover 30 minutes from the old timer.
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(setSetting).toHaveBeenCalledWith('last_refresh_at', expect.any(String))

    // Should keep ticking every 5 minutes.
    vi.mocked(setSetting).mockClear()
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(setSetting).toHaveBeenCalledWith('last_refresh_at', expect.any(String))
  })
})
