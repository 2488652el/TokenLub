import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSetting } from '../../../../code/src/main/store/settings-store'
import { syncAllSessions } from '../../../../code/src/main/log-parsers/sync'

vi.mock('../../../../code/src/main/store/settings-store', () => ({
  getSetting: vi.fn()
}))

vi.mock('../../../../code/src/main/log-parsers/sync', () => ({
  syncAllSessions: vi.fn()
}))

describe('session auto-parse scheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(getSetting).mockImplementation((key: string) => {
      if (key === 'session_auto_parse_enabled') return true
      if (key === 'refresh_interval_min') return 15
      return null
    })
  })

  afterEach(async () => {
    vi.mocked(getSetting).mockReturnValue(false)
    const { restartSessionAutoParse } =
      await import('../../../../code/src/main/scheduler/session-auto-parse')
    restartSessionAutoParse()
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('does not parse when automatic parsing is disabled', async () => {
    vi.mocked(getSetting).mockReturnValue(false)
    const { startSessionAutoParse } =
      await import('../../../../code/src/main/scheduler/session-auto-parse')

    startSessionAutoParse()
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    expect(syncAllSessions).not.toHaveBeenCalled()
  })

  it('parses both sources immediately and on the configured interval', async () => {
    const { startSessionAutoParse } =
      await import('../../../../code/src/main/scheduler/session-auto-parse')

    startSessionAutoParse()

    expect(syncAllSessions).toHaveBeenNthCalledWith(1, 'claude-code')
    expect(syncAllSessions).toHaveBeenNthCalledWith(2, 'codex')

    vi.mocked(syncAllSessions).mockClear()
    await vi.advanceTimersByTimeAsync(15 * 60 * 1000)

    expect(syncAllSessions).toHaveBeenNthCalledWith(1, 'claude-code')
    expect(syncAllSessions).toHaveBeenNthCalledWith(2, 'codex')
  })

  it('stops future parsing after the switch is disabled', async () => {
    const { startSessionAutoParse, restartSessionAutoParse } =
      await import('../../../../code/src/main/scheduler/session-auto-parse')
    startSessionAutoParse()
    vi.mocked(syncAllSessions).mockClear()

    vi.mocked(getSetting).mockReturnValue(false)
    restartSessionAutoParse()
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)

    expect(syncAllSessions).not.toHaveBeenCalled()
  })
})
