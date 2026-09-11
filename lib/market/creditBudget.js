const MINUTE_MS = 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

function positiveInteger(value, fallback, maximum) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) return fallback
  return Math.min(parsed, maximum)
}

export function createCreditBudget({
  dailyLimit = 800,
  minuteLimit = 6,
  now = () => Date.now(),
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
  const safeDailyLimit = positiveInteger(dailyLimit, 800, 10000)
  const safeMinuteLimit = positiveInteger(minuteLimit, 6, 100)
  let creditEvents = []

  function prune(timestamp) {
    creditEvents = creditEvents.filter((event) => timestamp - event.timestamp < DAY_MS)
  }

  function getMinuteUsed(timestamp) {
    return creditEvents
      .filter((event) => timestamp - event.timestamp < MINUTE_MS)
      .reduce((sum, event) => sum + event.credits, 0)
  }

  function getDailyUsed(timestamp) {
    return creditEvents.reduce((sum, event) => sum + event.credits, 0)
  }

  return {
    inspect() {
      const timestamp = now()
      prune(timestamp)
      return {
        scope: 'process-local',
        dailyLimit: safeDailyLimit,
        minuteLimit: safeMinuteLimit,
        dailyUsed: getDailyUsed(timestamp),
        minuteUsed: getMinuteUsed(timestamp),
      }
    },

    consume(credits = 1) {
      const timestamp = now()
      prune(timestamp)
      const minuteUsed = getMinuteUsed(timestamp)
      const dailyUsed = getDailyUsed(timestamp)

      if (dailyUsed + credits > safeDailyLimit) {
        return {
          ok: false,
          code: 'credit_daily_budget_exceeded',
          retryAfterSeconds: Math.max(1, Math.ceil((DAY_MS - (timestamp - creditEvents[0].timestamp)) / 1000)),
          budget: this.inspect(),
        }
      }

      if (minuteUsed + credits > safeMinuteLimit) {
        const oldestInWindow = creditEvents.find((e) => timestamp - e.timestamp < MINUTE_MS)
        const retryAfter = oldestInWindow
          ? Math.max(1, Math.ceil((MINUTE_MS - (timestamp - oldestInWindow.timestamp)) / 1000))
          : 60
        return {
          ok: false,
          code: 'credit_minute_budget_exceeded',
          retryAfterSeconds: retryAfter,
          budget: this.inspect(),
        }
      }

      creditEvents.push({ timestamp, credits })
      return { ok: true, budget: this.inspect() }
    },

    async waitForCapacity(credits = 1) {
      while (true) {
        const decision = this.consume(credits)
        if (decision.ok) {
          return decision.budget
        }
        const waitMs = Math.max(100, (decision.retryAfterSeconds ?? 1) * 1000)
        await sleep(waitMs)
      }
    },

    recordExternalConsumption(credits, timestamp = now()) {
      creditEvents.push({ timestamp, credits })
    },

    reset() {
      creditEvents = []
    },
  }
}

export const creditBudget = createCreditBudget()