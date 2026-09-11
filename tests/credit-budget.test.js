import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createCreditBudget } from '../lib/market/creditBudget.js'

describe('Credit Budget - 6 credits/minute enforcement', () => {
  let budget, now, sleep, currentTime

  beforeEach(() => {
    currentTime = 0
    now = () => currentTime
    sleep = async (ms) => {
      currentTime += ms
    }
    budget = createCreditBudget({
      dailyLimit: 10000,
      minuteLimit: 6,
      now,
      sleep,
    })
  })

  function advance(ms) {
    currentTime += ms
  }

  function getCurrentTime() {
    return currentTime
  }

  it('consumes credits up to minute limit', () => {
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.inspect().minuteUsed).toBe(6)
  })

  it('rejects 7th credit in same minute', () => {
    for (let i = 0; i < 6; i++) budget.consume(1)
    const result = budget.consume(1)
    expect(result.ok).toBe(false)
    expect(result.code).toBe('credit_minute_budget_exceeded')
    expect(result.retryAfterSeconds).toBeGreaterThan(0)
    expect(result.retryAfterSeconds).toBeLessThanOrEqual(60)
  })

  it('waitForCapacity blocks until window resets', async () => {
    for (let i = 0; i < 6; i++) {
      const result = await budget.waitForCapacity(1)
      expect(result.minuteUsed).toBe(i + 1)
    }
    expect(budget.inspect().minuteUsed).toBe(6)

    // 7th should wait
    const waitPromise = budget.waitForCapacity(1)
    
    // Advance time by 30 seconds - still in window
    advance(30000)
    
    // Should not resolve yet
    let resolved = false
    waitPromise.then(() => { resolved = true })
    await vi.waitFor(() => {}, { timeout: 100 })
    expect(resolved).toBe(false)

    // Advance past the window
    advance(35000)
    await waitPromise
    expect(resolved).toBe(true)
  })

  it('cold acquisition: batch quote (5) + 5 histories = 10 credits, must wait for window', async () => {
    const start = getCurrentTime()
    
    // Batch quote: 5 credits
    await budget.waitForCapacity(5)
    expect(budget.inspect().minuteUsed).toBe(5)
    
    // First history: 1 credit (last in window)
    await budget.waitForCapacity(1)
    expect(budget.inspect().minuteUsed).toBe(6)
    
    // Second history: must wait for window reset
    const waitStart = getCurrentTime()
    await budget.waitForCapacity(1)
    const waitTime = getCurrentTime() - waitStart
    
    // Should have waited ~60 seconds for window to clear
    expect(waitTime).toBeGreaterThan(55000)
    expect(waitTime).toBeLessThan(70000)
    
    // Remaining 3 histories
    for (let i = 0; i < 3; i++) {
      await budget.waitForCapacity(1)
    }
    
    const totalTime = getCurrentTime() - start
    // Total: ~60s for window reset + minimal time for rest
    expect(totalTime).toBeGreaterThan(55000)
    expect(totalTime).toBeLessThan(120000)
  })

  it('warm acquisition: batch quote (5 credits) only', async () => {
    // First build: 5 credits
    await budget.waitForCapacity(5)
    expect(budget.inspect().minuteUsed).toBe(5)
    
    // Second build (warm): only 5 credits for batch quote
    // Must wait for first 5 to expire from window
    await budget.waitForCapacity(5)
    // After window reset, only new 5 credits in window
    expect(budget.inspect().minuteUsed).toBe(5)
  })

  it('warm acquisition respects minute limit: batch quote (5) + 5 = 10 > 6, must wait', async () => {
    // First build
    await budget.waitForCapacity(5)
    expect(budget.inspect().minuteUsed).toBe(5)
    
    // Second build: 5 more credits, but 5+5=10 > 6, must wait for window
    const waitStart = getCurrentTime()
    await budget.waitForCapacity(5)
    const waitTime = getCurrentTime() - waitStart
    
    // Should wait for first 5 to expire (~60s)
    expect(waitTime).toBeGreaterThan(55000)
    expect(waitTime).toBeLessThan(70000)
    // After wait, only 5 credits in window
    expect(budget.inspect().minuteUsed).toBe(5)
  })

  it('prior window usage reduces available capacity', async () => {
    // Simulate prior usage in current window
    budget.recordExternalConsumption(3)
    expect(budget.inspect().minuteUsed).toBe(3)
    
    // Only 3 credits available in this window
    await budget.waitForCapacity(3) // ok
    expect(budget.inspect().minuteUsed).toBe(6)
    
    // 4th credit must wait
    const waitStart = getCurrentTime()
    await budget.waitForCapacity(1)
    const waitTime = getCurrentTime() - waitStart
    expect(waitTime).toBeGreaterThan(55000)
  })

  it('daily limit enforcement', async () => {
    const dailyBudget = createCreditBudget({ dailyLimit: 10, minuteLimit: 10000, now })
    for (let i = 0; i < 10; i++) {
      expect(dailyBudget.consume(1).ok).toBe(true)
    }
    expect(dailyBudget.consume(1).ok).toBe(false)
    expect(dailyBudget.consume(1).code).toBe('credit_daily_budget_exceeded')
  })

  it('no arbitrary sleep bypasses budget', () => {
    // The budget is enforced by credit events, not by sleep
    // Arbitrary sleep without advancing 'now' doesn't help
    expect(budget.consume(5).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(true)
    expect(budget.consume(1).ok).toBe(false)
  })
})