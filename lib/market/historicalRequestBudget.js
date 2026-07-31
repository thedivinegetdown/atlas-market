const DEFAULT_DAILY_LIMIT = 720
const DEFAULT_MINUTE_LIMIT = 6
const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

export function createHistoricalRequestBudget({
  dailyLimit = DEFAULT_DAILY_LIMIT,
  minuteLimit = DEFAULT_MINUTE_LIMIT,
  now = () => Date.now(),
} = {}) {
  const safeDailyLimit = positiveInteger(dailyLimit, DEFAULT_DAILY_LIMIT, 800)
  const safeMinuteLimit = positiveInteger(minuteLimit, DEFAULT_MINUTE_LIMIT, 8)
  let attempts = []

  function prune(timestamp) {
    attempts = attempts.filter((attemptedAt) => timestamp - attemptedAt < DAY_MS)
  }

  return {
    inspect() {
      const timestamp = now()
      prune(timestamp)
      return {
        scope: 'process-local',
        dailyLimit: safeDailyLimit,
        minuteLimit: safeMinuteLimit,
        dailyUsed: attempts.length,
        minuteUsed: attempts.filter((attemptedAt) => timestamp - attemptedAt < MINUTE_MS).length,
      }
    },

    consume() {
      const timestamp = now()
      prune(timestamp)
      const minuteAttempts = attempts.filter((attemptedAt) => timestamp - attemptedAt < MINUTE_MS)
      if (attempts.length >= safeDailyLimit) {
        return {
          ok: false,
          code: 'historical_daily_budget_exceeded',
          retryAfterSeconds: Math.max(1, Math.ceil((DAY_MS - (timestamp - attempts[0])) / 1000)),
          budget: this.inspect(),
        }
      }
      if (minuteAttempts.length >= safeMinuteLimit) {
        return {
          ok: false,
          code: 'historical_minute_budget_exceeded',
          retryAfterSeconds: Math.max(1, Math.ceil((MINUTE_MS - (timestamp - minuteAttempts[0])) / 1000)),
          budget: this.inspect(),
        }
      }
      attempts.push(timestamp)
      return { ok: true, budget: this.inspect() }
    },
  }
}
