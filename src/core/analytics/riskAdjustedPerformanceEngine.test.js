import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  createRiskAdjustedPerformanceEngine,
  evaluateRiskAdjustedPerformance,
  PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT,
} from './riskAdjustedPerformanceEngine.js'

function journalRecord(overrides = {}) {
  return {
    tradeId: overrides.tradeId ?? 'trade-1',
    symbol: overrides.symbol ?? 'SPY',
    paperTrading: true,
    journalStatus: overrides.journalStatus ?? 'recorded',
    realizedPnl: overrides.realizedPnl ?? 0,
    fill: overrides.fill ?? { fillPrice: 100 },
    decisionGate: overrides.decisionGate ?? {
      guardrail: 'approved',
      execution: 'filled',
      accounting: 'updated',
    },
  }
}

describe('riskAdjustedPerformanceEngine', () => {
  it('builds a return series from filled paper journal records', () => {
    const result = evaluateRiskAdjustedPerformance([
      journalRecord({ tradeId: 'win-1', realizedPnl: 500 }),
      journalRecord({ tradeId: 'loss-1', realizedPnl: -250 }),
      journalRecord({ tradeId: 'win-2', realizedPnl: 300 }),
    ], {
      emitEvent: false,
      startingEquity: 10000,
    })

    expect(result.paperTrading).toBe(true)
    expect(result.eventType).toBe(PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT)
    expect(result.includedTrades).toBe(3)
    expect(result.returnSeries).toHaveLength(3)
    expect(result.returnSeries[0]).toMatchObject({
      tradeId: 'win-1',
      startingEquity: 10000,
      endingEquity: 10500,
      returnPct: 5,
    })
    expect(result.metrics.netRealizedPnl).toBe(550)
    expect(result.metrics.totalTrades).toBe(3)
  })

  it('calculates volatility, drawdown, recovery factor, and a grade', () => {
    const result = evaluateRiskAdjustedPerformance([
      journalRecord({ tradeId: 'win-1', realizedPnl: 500 }),
      journalRecord({ tradeId: 'loss-1', realizedPnl: -250 }),
      journalRecord({ tradeId: 'win-2', realizedPnl: 300 }),
      journalRecord({ tradeId: 'loss-2', realizedPnl: -100 }),
    ], {
      emitEvent: false,
      startingEquity: 10000,
    })

    expect(result.metrics.volatilityEstimate).toBeGreaterThan(0)
    expect(result.metrics.sharpeStyleScore).toBeGreaterThan(0)
    expect(result.metrics.sortinoStyleDownsideScore).toBeGreaterThan(0)
    expect(result.metrics.maxDrawdown).toBeCloseTo(2.381, 2)
    expect(result.metrics.averageDrawdown).toBeGreaterThan(0)
    expect(result.metrics.recoveryFactor).toBeCloseTo(1.8, 1)
    expect(['A', 'B', 'C', 'D', 'F']).toContain(result.metrics.riskAdjustedGrade)
  })

  it('reuses paper performance inclusion rules to exclude rejected and non-filled trades', () => {
    const result = evaluateRiskAdjustedPerformance([
      journalRecord({ tradeId: 'filled', realizedPnl: 200 }),
      journalRecord({
        tradeId: 'rejected',
        realizedPnl: 900,
        journalStatus: 'rejected',
        fill: null,
        decisionGate: {
          guardrail: 'rejected',
          execution: 'rejected',
          accounting: 'rejected',
        },
      }),
      journalRecord({
        tradeId: 'not-filled',
        realizedPnl: 400,
        fill: null,
        decisionGate: {
          guardrail: 'approved',
          execution: 'not_filled',
          accounting: 'rejected',
        },
      }),
    ], {
      emitEvent: false,
      startingEquity: 10000,
    })

    expect(result.includedTrades).toBe(1)
    expect(result.excludedTrades).toBe(2)
    expect(result.metrics.netRealizedPnl).toBe(200)
    expect(result.returnSeries.map((point) => point.tradeId)).toEqual(['filled'])
  })

  it('uses proposed trade snapshot identifiers when paper performance includes them', () => {
    const result = evaluateRiskAdjustedPerformance([
      {
        symbol: 'SPY',
        paperTrading: true,
        journalStatus: 'recorded',
        realizedPnl: 150,
        fill: { fillPrice: 100 },
        decisionGate: {
          guardrail: 'approved',
          execution: 'filled',
          accounting: 'updated',
        },
        proposedTradeSnapshot: {
          id: 'snapshot-trade',
          symbol: 'SPY',
        },
      },
    ], {
      emitEvent: false,
      startingEquity: 10000,
      performanceSnapshot: {
        includedTradeIds: ['snapshot-trade'],
        excludedTrades: 0,
        excludedReason: 'Included for regression coverage',
        metrics: {
          totalTrades: 1,
          netRealizedPnl: 150,
        },
      },
    })

    expect(result.includedTrades).toBe(1)
    expect(result.returnSeries[0].tradeId).toBe('snapshot-trade')
    expect(result.metrics.netRealizedPnl).toBe(150)
  })

  it('handles empty journal records safely', () => {
    const result = evaluateRiskAdjustedPerformance([], {
      emitEvent: false,
      startingEquity: 10000,
    })

    expect(result.status).toBe('evaluated')
    expect(result.includedTrades).toBe(0)
    expect(result.metrics.sharpeStyleScore).toBe(0)
    expect(result.metrics.sortinoStyleDownsideScore).toBe(0)
    expect(result.metrics.maxDrawdown).toBe(0)
    expect(result.metrics.riskAdjustedGrade).toBe('C')
    expect(result.returnSeries).toEqual([])
  })

  it('emits the portfolio risk-adjusted performance event', () => {
    const eventBus = createEventBus()
    const events = []

    eventBus.subscribe(PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createRiskAdjustedPerformanceEngine({ eventBus }).evaluate([
      journalRecord({ tradeId: 'event-trade', realizedPnl: 125 }),
    ], {
      startingEquity: 10000,
      timestamp: '2026-07-03T12:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      eventType: PORTFOLIO_RISK_ADJUSTED_PERFORMANCE_EVALUATED_EVENT,
      paperTrading: true,
      timestamp: '2026-07-03T12:00:00.000Z',
    })
  })
})
