import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { STRATEGY_WALK_FORWARD_EVALUATED_EVENT, createStrategyWalkForwardTestingEngine, evaluateWalkForwardTesting } from './strategyWalkForwardTestingEngine.js'

const candles = Array.from({ length: 8 }, (_, index) => ({ timestamp: new Date(Date.UTC(2025, 0, index + 1)).toISOString(), close: 100 + index }))
const input = {
  historicalReplay: { normalizedHistoricalCandles: candles },
  inSampleWindowConfiguration: { size: 3 }, outOfSampleWindowConfiguration: { size: 2 },
  strategyBacktestExecution: { backtestExecutionStatus: 'completed', session: { sessionId: 'whole-run' } },
  strategyBacktestPerformance: { analyticsStatus: 'evaluated', metrics: { totalIncludedTrades: 100, netRealizedPnl: 10000, profitFactor: 100 }, returnCurveSummary: { totalReturnPct: 100 } },
}
const run = (value = input) => evaluateWalkForwardTesting(value, { emitEvent: false })

describe('walk-forward plans cannot masquerade as executed OOS evidence', () => {
  it('separates training/test boundaries and nonoverlapping test windows', () => {
    const result = run()
    expect(result.rollingWindows).toHaveLength(2)
    result.rollingWindows.forEach((window, index) => {
      expect(window.inSample.endIndex).toBeLessThan(window.outOfSample.startIndex)
      expect(Date.parse(window.inSample.endTimestamp)).toBeLessThan(Date.parse(window.outOfSample.startTimestamp))
      expect(window).toMatchObject({ planningOnly: true, executionStatus: 'NOT_EXECUTED' })
      if (index) expect(result.rollingWindows[index - 1].outOfSample.endIndex).toBeLessThan(window.outOfSample.startIndex)
    })
  })

  it('rejects both whole-run fallbacks and supplied per-window aggregates', () => {
    const result = run({ ...input, windowPerformanceSummaries: [input.strategyBacktestPerformance, input.strategyBacktestPerformance], windowExecutionReferences: [input.strategyBacktestExecution, input.strategyBacktestExecution] })
    expect(result.finalWalkForwardStatus).toBe('UNAVAILABLE')
    expect(result.reason).toBe('INDEPENDENT_OOS_EXECUTOR_UNAVAILABLE')
    expect(result.windowResults).toEqual([])
    expect(result.perWindowBacktestExecutionReferences).toEqual([])
    expect(result.perWindowPerformanceSummary).toEqual([])
    expect(result.robustnessScore).toBeNull()
    expect(result.degradationDetection.degraded).toBeNull()
  })

  it('does not let future prices or OOS aggregates change earlier plans', () => {
    const changed = structuredClone(input)
    changed.historicalReplay.normalizedHistoricalCandles[7].close = 999999
    changed.strategyBacktestPerformance.metrics.netRealizedPnl = -100000
    expect(run(changed).rollingWindows).toEqual(run().rollingWindows)
    expect(run(changed).windowResults).toEqual([])
  })

  it.each([
    [], candles.slice(0, 4), [...candles].reverse(),
    [...candles.slice(0, 4), { ...candles[4], timestamp: candles[3].timestamp }],
    [{ timestamp: 'invalid' }, ...candles],
  ].map((data) => [data]))('fails closed on insufficient or invalid chronology', (data) => {
    const result = run({ ...input, historicalReplay: { normalizedHistoricalCandles: data } })
    expect(result.reason).toBe('INSUFFICIENT_OR_INVALID_WINDOW_DATA')
    expect(result.rollingWindows).toEqual([])
    expect(result.finalWalkForwardStatus).toBe('UNAVAILABLE')
  })

  it('rejects invalid window sizes without coercion or a fallback', () => {
    for (const size of [0, -1, 1.5, Infinity, '3']) expect(run({ ...input, inSampleWindowConfiguration: { size } }).rollingWindows).toEqual([])
  })

  it('emits unavailable evidence through the existing API', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_WALK_FORWARD_EVALUATED_EVENT, (event) => events.push(event))
    const result = createStrategyWalkForwardTestingEngine({ eventBus }).evaluate(input)
    expect(events).toEqual([result])
  })
})
