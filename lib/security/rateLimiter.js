import { AppError } from '../errors/appError.js'

const defaultWindowMs = 60_000
const defaultLimit = 600

function nowMs() {
  return Date.now()
}

export function createRateLimiter({
  limit = defaultLimit,
  windowMs = defaultWindowMs,
  clock = nowMs,
} = {}) {
  const buckets = new Map()

  return {
    check(key = 'anonymous') {
      const currentTime = clock()
      const bucketKey = String(key)
      const current = buckets.get(bucketKey)

      if (!current || current.resetAt <= currentTime) {
        const next = {
          count: 1,
          resetAt: currentTime + windowMs,
        }
        buckets.set(bucketKey, next)
        return {
          allowed: true,
          remaining: Math.max(0, limit - next.count),
          resetAt: next.resetAt,
        }
      }

      if (current.count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          resetAt: current.resetAt,
        }
      }

      current.count += 1
      return {
        allowed: true,
        remaining: Math.max(0, limit - current.count),
        resetAt: current.resetAt,
      }
    },

    reset() {
      buckets.clear()
    },
  }
}

export const defaultRateLimiter = createRateLimiter()

export function assertRateLimit(rateLimiter, key) {
  const result = rateLimiter.check(key)
  if (!result.allowed) {
    throw new AppError('rate_limited', 'Rate limit exceeded', {
      statusCode: 429,
      publicMessage: 'too many requests',
      metadata: {
        key,
        resetAt: result.resetAt,
      },
    })
  }

  return result
}
