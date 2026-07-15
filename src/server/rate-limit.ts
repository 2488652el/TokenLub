export type RateLimitOptions = { max: number; windowMs: number }

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('rate limit exceeded')
    this.name = 'RateLimitError'
  }
}

export function createRateLimiter(options: RateLimitOptions) {
  const windows = new Map<string, { startedAt: number; count: number }>()
  return {
    check(key: string, now = Date.now()): void {
      const current = windows.get(key)
      if (!current || now - current.startedAt >= options.windowMs) {
        windows.set(key, { startedAt: now, count: 1 })
        return
      }
      if (current.count >= options.max) {
        throw new RateLimitError(
          Math.max(1, Math.ceil((options.windowMs - (now - current.startedAt)) / 1000))
        )
      }
      current.count++
    }
  }
}
