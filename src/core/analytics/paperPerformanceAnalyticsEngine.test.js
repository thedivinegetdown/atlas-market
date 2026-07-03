import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  PORTFOLIO_PERFORMANCE_EVALUATED_EVENT,
  createPaperPerformanceAnalyticsEngine,
  evaluatePaperPerformance,
} from './paperPerformanceAnalyticsEngine.js'

function journalRecord(overrides = {}) {
  return {
    tradeId: 'trade-1',
    paperTrading: true,
    journalStatus: 'recorded',
    realizedPnl: 100,
    fill: { fillPrice: 100 },
    decisionGate: {
      guardrail: 'approved',
      execution: 'filled',
      accounting: 'position_closed',
    },
    ...overrides,
  }
}

describe('paperPerformanceAnalyticsEngine', () => {
  it('calculates performance metrics from recorded filled paper trades', () => {
    const result = evaluatePaperPerformance([
      journalRecord({ tradeId: 'win-1', realizedPnl: 120 }),
      journalRecord({ tradeId: 'win-2', realizedPnl: 80 }),
      journalRecord({ tradeId: 'loss-1', realizedPnl: -50 }),
    ], { emitEvent: false, timestamp: '2026-07-03T17:00:00Z' })

    expect(result.eventType).toBe(PORTFOLIO_PERFORMANCE_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.metrics).toMatchObject({
      totalTrades: 3,
      winRate: 66.67,
      averageWin: 100,
      averageLoss: -50,
      profitFactor: 4,
      netRealizedPnl: 150,
      largestWin: 120,
      largestLoss: -50,
      expectancy: 50,
    })
  })

  it('excludes rejected and non-filled journal records', () => {
    const result = evaluatePaperPerformance([
      journalRecord({ tradeId: 'win-1', realizedPnl: 75 }),
      journalRecord({ tradeId: 'rejected', journalStatus: 'rejected', realizedPnl: 999, fill: null }),
      journalRecord({ tradeId: 'not-filled', decisionGate: { execution: 'not_filled', accounting: 'rejected' }, realizedPnl: -999 }),
    ], { emitEvent: false })

    expect(result.metrics.totalTrades).toBe(1)
    expect(result.excludedTrades).toBe(2)
    expect(result.includedTradeIds).toEqual(['win-1'])
    expect(result.metrics.netRealizedPnl).toBe(75)
  })

  it('handles empty journal input', () => {
    const result = evaluatePaperPerformance([], { emitEvent: false })

    expect(result.metrics.totalTrades).toBe(0)
    expect(result.metrics.winRate).toBe(0)
    expect(result.metrics.profitFactor).toBe(0)
    expect(result.metrics.expectancy).toBe(0)
  })

  it('emits portfolio.performance.evaluated', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_PERFORMANCE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createPaperPerformanceAnalyticsEngine({ eventBus }).evaluate([
      journalRecord({ tradeId: 'win-1', realizedPnl: 25 }),
    ])

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(PORTFOLIO_PERFORMANCE_EVALUATED_EVENT)
    expect(events[0].metrics.netRealizedPnl).toBe(result.metrics.netRealizedPnl)
  })
})
