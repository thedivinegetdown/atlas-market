import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT,
  createStrategyBacktestPerformanceAnalyticsEngine,
  evaluateBacktestPerformance,
} from './strategyBacktestPerformanceAnalyticsEngine.js'

function journalRecord({ tradeId, realizedPnl, status = 'recorded', execution = 'filled', accounting = 'updated' }) {
  return {
    eventType: 'trade.journal.recorded',
    paperTrading: true,
    journalStatus: status,
    status,
    tradeId,
    symbol: 'SPY',
    realizedPnl,
    fill: execution === 'filled' ? { fillPrice: 100, fees: 1, notional: 1000 } : null,
    decisionGate: {
      guardrail: 'approved',
      execution,
      accounting,
    },
    accountingUpdateSnapshot: {
      account: {
        realizedPnlDelta: realizedPnl,
      },
    },
  }
}

function buildExecution(overrides = {}) {
  return {
    eventType: 'strategy.backtest.executed',
    paperTrading: true,
    backtestExecutionStatus: 'completed',
    simulatedPaperTrades: [
      { journalRecord: journalRecord({ tradeId: 'win-1', realizedPnl: 120 }) },
      { journalRecord: journalRecord({ tradeId: 'loss-1', realizedPnl: -40 }) },
      { journalRecord: journalRecord({ tradeId: 'win-2', realizedPnl: 60 }) },
      { journalRecord: journalRecord({ tradeId: 'rejected-1', realizedPnl: 0, status: 'rejected', execution: 'rejected', accounting: 'missing' }) },
      { journalRecord: journalRecord({ tradeId: 'not-filled-1', realizedPnl: 0, status: 'rejected', execution: 'not_filled', accounting: 'missing' }) },
    ],
    ...overrides,
  }
}

describe('historical performance evidence boundary', () => {
  it.each(['completed', 'running', 'blocked'])('does not treat %s legacy fills as canonical historical outcomes', (status) => {
    const result = evaluateBacktestPerformance({
      strategyBacktestExecution: buildExecution({ backtestExecutionStatus: status }),
      startingEquity: 100000,
      paperPerformanceSnapshot: { metrics: { netRealizedPnl: 999999 } },
      riskAdjustedPerformanceSnapshot: { returnSeries: [{ endingEquity: 999999 }] },
    }, { emitEvent: false })
    expect(result.analyticsStatus).toBe('blocked')
    expect(result.evidenceStatus).toBe('UNAVAILABLE')
    expect(result.includedTrades).toBe(0)
    expect(result.excludedTrades).toBe(5)
    expect(result.metrics).toBeNull()
    expect(result.returnCurveSummary).toBeNull()
    expect(result.paperPerformanceSnapshot).toBeNull()
  })

  it('does not emit zero performance as evidence for missing inputs', () => {
    const result = evaluateBacktestPerformance({}, { emitEvent: false })
    expect(result.evidenceStatus).toBe('UNAVAILABLE')
    expect(result.metrics).toBeNull()
  })

  it('emits unavailable analytics through the existing API', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT, (event) => events.push(event))
    const result = createStrategyBacktestPerformanceAnalyticsEngine({ eventBus }).evaluate({ strategyBacktestExecution: buildExecution() })
    expect(events).toEqual([result])
  })
})
