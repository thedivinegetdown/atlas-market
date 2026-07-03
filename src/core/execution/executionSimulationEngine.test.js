import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { demoProposedTrades, guardrailDemoPortfolio } from '../../data/demoPortfolio.js'
import { evaluateTradeGuardrail } from '../risk/tradeGuardrailEngine.js'
import {
  TRADE_EXECUTION_SIMULATED_EVENT,
  createExecutionSimulationEngine,
  simulateTradeExecution,
} from './executionSimulationEngine.js'

function approvedGuardrail(overrides = {}) {
  return evaluateTradeGuardrail(guardrailDemoPortfolio, {
    ...demoProposedTrades[0],
    ...overrides,
  }, { emitEvent: false })
}

describe('executionSimulationEngine', () => {
  it('simulates a market fill with slippage and fees', () => {
    const guardrail = approvedGuardrail({ orderType: 'market', price: 526, stopPrice: 513 })
    const result = simulateTradeExecution(guardrail, {
      bid: 525.9,
      ask: 526.1,
      last: 526,
      liquidityScore: 90,
    }, {
      emitEvent: false,
      timestamp: '2026-07-03T15:00:00Z',
    })

    expect(result.eventType).toBe(TRADE_EXECUTION_SIMULATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.finalStatus).toBe('filled')
    expect(result.fill.fillPrice).toBeGreaterThan(526.1)
    expect(result.fill.slippageBps).toBeGreaterThan(0)
    expect(result.fill.fees).toBeGreaterThan(0)
  })

  it('simulates a marketable limit fill', () => {
    const guardrail = approvedGuardrail({ orderType: 'limit', price: 526, stopPrice: 513 })
    const result = simulateTradeExecution(guardrail, {
      bid: 525.7,
      ask: 525.9,
      low: 525.4,
      high: 526.4,
      liquidityScore: 96,
    }, { emitEvent: false })

    expect(result.finalStatus).toBe('filled')
    expect(result.reason).toContain('Limit price')
    expect(result.fill.orderType).toBe('limit')
  })

  it('returns not_filled when a limit order is not marketable', () => {
    const guardrail = approvedGuardrail({ orderType: 'limit', price: 520, stopPrice: 513 })
    const result = simulateTradeExecution(guardrail, {
      bid: 525,
      ask: 526,
      low: 524.5,
      high: 526.4,
    }, { emitEvent: false })

    expect(result.finalStatus).toBe('not_filled')
    expect(result.fill).toBeNull()
  })

  it('simulates a triggered stop fill', () => {
    const guardrail = approvedGuardrail({
      side: 'sell',
      orderType: 'stop',
      quantity: 4,
      price: 526,
      stopPrice: 520,
    })
    const result = simulateTradeExecution(guardrail, {
      bid: 519.8,
      ask: 520,
      last: 519.9,
      low: 519,
      high: 526,
      liquidityScore: 88,
    }, { emitEvent: false })

    expect(result.finalStatus).toBe('filled')
    expect(result.fill.side).toBe('sell')
    expect(result.fill.fillPrice).toBeLessThan(520)
  })

  it('rejects execution when guardrail decision is not approved', () => {
    const rejectedGuardrail = evaluateTradeGuardrail(guardrailDemoPortfolio, {
      ...demoProposedTrades[0],
      paperTrading: false,
    }, { emitEvent: false })
    const result = simulateTradeExecution(rejectedGuardrail, { bid: 525, ask: 526 }, { emitEvent: false })

    expect(result.finalStatus).toBe('rejected')
    expect(result.fill).toBeNull()
    expect(result.reason).toContain('guardrail')
  })

  it('emits trade.execution.simulated', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(TRADE_EXECUTION_SIMULATED_EVENT, (payload) => events.push(payload))
    const guardrail = approvedGuardrail()

    const result = createExecutionSimulationEngine({ eventBus }).simulate(guardrail, {
      bid: 525.8,
      ask: 525.9,
      low: 525.2,
      high: 526.5,
      liquidityScore: 92,
    })

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(TRADE_EXECUTION_SIMULATED_EVENT)
    expect(events[0].finalStatus).toBe(result.finalStatus)
  })
})
