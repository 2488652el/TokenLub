import { describe, expect, it } from 'vitest'
import { createRateLimiter, RateLimitError } from '../../../../drive/src/server/rate-limit'

describe('rate limiter', () => {
  it('limits a key within a window and resets after it expires', () => {
    const limiter = createRateLimiter({ max: 1, windowMs: 1000 })

    limiter.check('device', 0)
    expect(() => limiter.check('device', 500)).toThrow(RateLimitError)
    expect(() => limiter.check('device', 1000)).not.toThrow()
  })
})
