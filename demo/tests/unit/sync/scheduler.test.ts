import { describe, expect, it, vi } from 'vitest'

describe('createSyncScheduler', () => {
  it('shares one in-flight run across concurrent triggers', async () => {
    const run = vi.fn<() => Promise<void>>()
    let release!: () => void
    run.mockReturnValue(new Promise<void>((resolve) => (release = resolve)))
    const { createSyncScheduler } = await import('../../../../code/src/main/sync/scheduler')
    const scheduler = createSyncScheduler(run)

    const first = scheduler.trigger()
    const second = scheduler.trigger()

    await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    release()
    await Promise.all([first, second])
  })

  it('runs once more when triggered during an in-flight sync', async () => {
    let release!: () => void
    const run = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValueOnce(undefined)
    const { createSyncScheduler } = await import('../../../../code/src/main/sync/scheduler')
    const scheduler = createSyncScheduler(run)

    const first = scheduler.trigger()
    await Promise.resolve()
    void scheduler.trigger()
    release()
    await first
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(2))
  })

  it('retries failures with exponential backoff and resets after success', async () => {
    vi.useFakeTimers()
    try {
      const run = vi
        .fn<() => Promise<void>>()
        .mockRejectedValueOnce(new Error('temporary'))
        .mockRejectedValueOnce(new Error('temporary'))
        .mockResolvedValue(undefined)
      const { createSyncScheduler } = await import('../../../../code/src/main/sync/scheduler')
      const scheduler = createSyncScheduler(run, { baseDelayMs: 100, maxDelayMs: 500 })

      await expect(scheduler.trigger()).rejects.toThrow('temporary')
      expect(run).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(99)
      expect(run).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(run).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(199)
      expect(run).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(run).toHaveBeenCalledTimes(3)

      await scheduler.trigger()
      await expect(scheduler.trigger()).resolves.toBeUndefined()
      expect(run).toHaveBeenCalledTimes(5)
    } finally {
      vi.useRealTimers()
    }
  })

  it('lets a manual trigger supersede a pending retry', async () => {
    vi.useFakeTimers()
    try {
      const run = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('temporary'))
      const { createSyncScheduler } = await import('../../../../code/src/main/sync/scheduler')
      const scheduler = createSyncScheduler(run, { baseDelayMs: 100 })

      await expect(scheduler.trigger()).rejects.toThrow('temporary')
      await scheduler.trigger().catch(() => undefined)
      expect(run).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(100)
      expect(run).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not retry permanent errors', async () => {
    vi.useFakeTimers()
    try {
      const permanent = new Error('permanent')
      const run = vi.fn<() => Promise<void>>().mockRejectedValue(permanent)
      const { createSyncScheduler } = await import('../../../../code/src/main/sync/scheduler')
      const scheduler = createSyncScheduler(run, {
        baseDelayMs: 100,
        shouldRetry: (error) => error !== permanent
      })

      await expect(scheduler.trigger()).rejects.toThrow('permanent')
      await vi.advanceTimersByTimeAsync(1_000)

      expect(run).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
