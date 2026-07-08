import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  STRATEGY_WALK_FORWARD_EVALUATED_EVENT,
  createStrategyWalkForwardTestingEngine,
  evaluateWalkForwardTesting,
} from './strategyWalkForwardTestingEngine.js'

const historicalReplay = Object.freeze({
  eventType: 'market.replay.stepPrepared',
  normalizedHistoricalCandles: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 100 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 101 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 102 }),
    Object.freeze({ timestamp: '2025-01-04T00:00:00.000Z', close: 103 }),
    Object.freeze({ timestamp: '2025-01-05T00:00:00.000Z', close: 104 }),
  ]),
})

const backtestExecution = Object.freeze({
  eventType: 'strategy.backtest.executed',
  backtestExecutionStatus: 'completed',
  session: Object.freeze({ sessionId: 'wf-session' }),
})

const basePerformance = Object.freeze({
  eventType: 'strategy.backtestPerformance.evaluated',
  analyticsStatus: 'evaluated',
  metrics: Object.freeze({
    totalSimulatedTrades: 4,
    totalIncludedTrades: 3,
    winRate: 66.67,
    netRealizedPnl: 140,
    profitFactor: 2.5,
    expectancy: 46.67,
    maxDrawdown: 3,
  }),
  returnCurveSummary: Object.freeze({
    totalReturnPct: 4,
  }),
})

describe('strategy walk-forward testing engine', () => {
  it('generates rolling windows and evaluates robust walk-forward performance', () => {
    const result = evaluateWalkForwardTesting({
      historicalReplay,
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: basePerformance,
      inSampleWindowConfiguration: { size: 2 },
      outOfSampleWindowConfiguration: { size: 1 },
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T01:00:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_WALK_FORWARD_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.rollingWindows).toHaveLength(3)
    expect(result.windowResults[0].inSample.candleCount).toBe(2)
    expect(result.windowResults[0].outOfSample.candleCount).toBe(1)
    expect(result.perWindowBacktestExecutionReferences[0].eventType).toBe('strategy.backtest.executed')
    expect(result.perWindowPerformanceSummary[0].netRealizedPnl).toBe(140)
    expect(result.robustnessScore).toBeGreaterThanOrEqual(70)
    expect(result.finalWalkForwardStatus).toBe('robust')
  })

  it('detects degradation across supplied window performance summaries', () => {
    const result = evaluateWalkForwardTesting({
      historicalReplay,
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: basePerformance,
      inSampleWindowConfiguration: { size: 2 },
      outOfSampleWindowConfiguration: { size: 1 },
      windowPerformanceSummaries: [
        { metrics: { totalIncludedTrades: 2, profitFactor: 2.4, expectancy: 50, maxDrawdown: 2 }, returnCurveSummary: { totalReturnPct: 5 } },
        { metrics: { totalIncludedTrades: 2, profitFactor: 1.4, expectancy: 20, maxDrawdown: 4 }, returnCurveSummary: { totalReturnPct: 1 } },
        { metrics: { totalIncludedTrades: 1, profitFactor: 0.8, expectancy: -5, maxDrawdown: 8 }, returnCurveSummary: { totalReturnPct: -2 } },
      ],
    }, { emitEvent: false })

    expect(result.degradationDetection.degraded).toBe(true)
    expect(result.degradationDetection.notes).toContain('Out-of-sample return declined across windows')
    expect(result.finalWalkForwardStatus).toBe('caution')
  })

  it('fails when no rolling windows can be generated', () => {
    const result = evaluateWalkForwardTesting({
      historicalReplay: { ...historicalReplay, normalizedHistoricalCandles: [historicalReplay.normalizedHistoricalCandles[0]] },
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: basePerformance,
      inSampleWindowConfiguration: { size: 2 },
      outOfSampleWindowConfiguration: { size: 1 },
    }, { emitEvent: false })

    expect(result.rollingWindows).toHaveLength(0)
    expect(result.robustnessScore).toBe(0)
    expect(result.finalWalkForwardStatus).toBe('failed')
  })

  it('emits strategy walk-forward evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_WALK_FORWARD_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyWalkForwardTestingEngine({ eventBus }).evaluate({
      historicalReplay,
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: basePerformance,
      inSampleWindowConfiguration: { size: 2 },
      outOfSampleWindowConfiguration: { size: 1 },
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_WALK_FORWARD_EVALUATED_EVENT)
  })
})
