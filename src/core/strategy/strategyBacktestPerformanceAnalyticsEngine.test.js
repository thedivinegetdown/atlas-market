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

describe('strategy backtest performance analytics engine', () => {
  it('evaluates completed backtest performance and excludes rejected or non-filled trades', () => {
    const result = evaluateBacktestPerformance({
      strategyBacktestExecution: buildExecution(),
      startingEquity: 100000,
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T00:30:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.analyticsStatus).toBe('evaluated')
    expect(result.totalSimulatedTrades).toBe(5)
    expect(result.includedTrades).toBe(3)
    expect(result.excludedTrades).toBe(2)
    expect(result.metrics).toMatchObject({
      totalSimulatedTrades: 5,
      totalIncludedTrades: 3,
      winRate: 66.67,
      netRealizedPnl: 140,
      averageWin: 90,
      averageLoss: -40,
      profitFactor: 4.5,
      expectancy: 46.67,
    })
    expect(result.returnCurveSummary.points).toHaveLength(3)
    expect(result.paperPerformanceSnapshot.includedTradeIds).toEqual(['win-1', 'loss-1', 'win-2'])
  })

  it('returns caution while a backtest session is still running', () => {
    const result = evaluateBacktestPerformance({
      strategyBacktestExecution: buildExecution({ backtestExecutionStatus: 'running' }),
      startingEquity: 100000,
    }, { emitEvent: false })

    expect(result.analyticsStatus).toBe('caution')
    expect(result.backtestExecutionStatus).toBe('running')
    expect(result.metrics.totalIncludedTrades).toBe(3)
  })

  it('blocks analytics when backtest execution is blocked', () => {
    const result = evaluateBacktestPerformance({
      strategyBacktestExecution: buildExecution({
        backtestExecutionStatus: 'blocked',
        simulatedPaperTrades: [],
      }),
    }, { emitEvent: false })

    expect(result.analyticsStatus).toBe('blocked')
    expect(result.reason).toBe('Backtest execution is blocked')
    expect(result.metrics.totalIncludedTrades).toBe(0)
  })

  it('emits strategy backtest performance evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyBacktestPerformanceAnalyticsEngine({ eventBus }).evaluate({
      strategyBacktestExecution: buildExecution(),
      startingEquity: 100000,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_BACKTEST_PERFORMANCE_EVALUATED_EVENT)
  })
})
