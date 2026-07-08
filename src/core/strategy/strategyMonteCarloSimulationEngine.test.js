import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  STRATEGY_MONTE_CARLO_SIMULATED_EVENT,
  createStrategyMonteCarloSimulationEngine,
  simulateMonteCarloStrategy,
} from './strategyMonteCarloSimulationEngine.js'

const backtestPerformance = Object.freeze({
  eventType: 'strategy.backtestPerformance.evaluated',
  metrics: Object.freeze({
    totalIncludedTrades: 4,
    winRate: 75,
    averageWin: 120,
    averageLoss: -40,
    netRealizedPnl: 320,
    maxDrawdown: 2,
  }),
  returnCurveSummary: Object.freeze({
    startingEquity: 100000,
    points: Object.freeze([
      Object.freeze({ tradeId: 't1', endingEquity: 100120 }),
      Object.freeze({ tradeId: 't2', endingEquity: 100080 }),
      Object.freeze({ tradeId: 't3', endingEquity: 100200 }),
      Object.freeze({ tradeId: 't4', endingEquity: 100320 }),
    ]),
  }),
  riskAdjustedPerformanceSnapshot: Object.freeze({
    eventType: 'portfolio.riskAdjustedPerformance.evaluated',
  }),
})

describe('strategy monte carlo simulation engine', () => {
  it('generates deterministic randomized equity curves and confidence intervals', () => {
    const result = simulateMonteCarloStrategy({
      strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: { eventType: 'strategy.walkForward.evaluated', finalWalkForwardStatus: 'robust' },
      drawdownProtection: { eventType: 'portfolio.drawdownProtection.evaluated', maxDrawdownThreshold: 10 },
      simulationCount: 25,
      seed: 7,
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T01:30:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_MONTE_CARLO_SIMULATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.simulationCount).toBe(25)
    expect(result.randomizedEquityCurves).toHaveLength(25)
    expect(result.tradeOutcomeSampling.sampledOutcomes).toEqual([120, -40, 120, 120])
    expect(result.confidenceIntervalSummary.finalEquityP05).toBeGreaterThan(0)
    expect(result.probabilityOfProfitability).toBeGreaterThan(70)
    expect(result.probabilityOfDrawdownBreach).toBe(0)
    expect(result.robustnessClassification).toBe('robust')
  })

  it('classifies caution when walk-forward robustness is caution despite profitable paths', () => {
    const result = simulateMonteCarloStrategy({
      strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: { finalWalkForwardStatus: 'caution' },
      simulationCount: 10,
      seed: 11,
    }, { emitEvent: false })

    expect(result.probabilityOfProfitability).toBeGreaterThan(0)
    expect(result.robustnessClassification).toBe('caution')
  })

  it('classifies fragile when profitability is poor or drawdown breach risk is high', () => {
    const result = simulateMonteCarloStrategy({
      strategyBacktestPerformance: {
        ...backtestPerformance,
        metrics: {
          totalIncludedTrades: 4,
          winRate: 25,
          averageWin: 20,
          averageLoss: -150,
        },
        returnCurveSummary: {
          startingEquity: 100000,
          points: [
            { tradeId: 'l1', endingEquity: 99850 },
            { tradeId: 'l2', endingEquity: 99700 },
            { tradeId: 'w1', endingEquity: 99720 },
            { tradeId: 'l3', endingEquity: 99570 },
          ],
        },
      },
      strategyWalkForward: { finalWalkForwardStatus: 'failed' },
      drawdownThreshold: 0.1,
      simulationCount: 20,
      seed: 3,
    }, { emitEvent: false })

    expect(result.robustnessClassification).toBe('fragile')
    expect(result.probabilityOfDrawdownBreach).toBeGreaterThan(0)
  })

  it('emits strategy monte carlo simulated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_MONTE_CARLO_SIMULATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyMonteCarloSimulationEngine({ eventBus }).simulate({
      strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: { finalWalkForwardStatus: 'robust' },
      simulationCount: 5,
      seed: 5,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_MONTE_CARLO_SIMULATED_EVENT)
  })
})
