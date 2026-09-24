import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  STRATEGY_BACKTEST_REPORT_GENERATED_EVENT,
  createStrategyBacktestReportGenerator,
  generateBacktestReport,
} from './strategyBacktestReportGenerator.js'

const backtestExecution = Object.freeze({
  eventType: 'strategy.backtest.executed',
  backtestExecutionStatus: 'completed',
  session: Object.freeze({
    sessionId: 'report-session',
    strategyId: 'index-pullback-v1',
    symbol: 'SPY',
    assetType: 'etf',
    timeframe: 'swing',
    consumedCandles: 20,
  }),
  executionSummary: Object.freeze({
    generatedTrades: 6,
    filledTrades: 5,
    rejectedTrades: 1,
  }),
})

const backtestPerformance = Object.freeze({
  eventType: 'strategy.backtestPerformance.evaluated',
  analyticsStatus: 'evaluated',
  includedTrades: 5,
  excludedTrades: 1,
  metrics: Object.freeze({
    totalSimulatedTrades: 6,
    totalIncludedTrades: 5,
    winRate: 60,
    netRealizedPnl: 420,
    averageWin: 180,
    averageLoss: -60,
    profitFactor: 2,
    expectancy: 84,
    maxDrawdown: 4,
  }),
  returnCurveSummary: Object.freeze({
    startingEquity: 100000,
    endingEquity: 100420,
    totalReturnPct: 0.42,
    points: Object.freeze([
      Object.freeze({ tradeId: 't1', endingEquity: 100180 }),
      Object.freeze({ tradeId: 't2', endingEquity: 100120 }),
      Object.freeze({ tradeId: 't3', endingEquity: 100420 }),
    ]),
  }),
  summary: 'Backtest performance evaluated.',
})

const walkForward = Object.freeze({
  eventType: 'strategy.walkForward.evaluated',
  finalWalkForwardStatus: 'robust',
  robustnessScore: 82,
  rollingWindows: Object.freeze([Object.freeze({ id: 'wf-1' }), Object.freeze({ id: 'wf-2' })]),
  degradationDetection: Object.freeze({
    degraded: false,
    degradationPct: 0,
    notes: Object.freeze([]),
  }),
  summary: 'Walk-forward robust.',
})

const monteCarlo = Object.freeze({
  eventType: 'strategy.monteCarlo.simulated',
  robustnessClassification: 'robust',
  simulationCount: 100,
  tradeOutcomeSampling: Object.freeze({ sourceTradeCount: 5 }),
  probabilityOfDrawdownBreach: 8,
  probabilityOfProfitability: 78,
  drawdownThreshold: 10,
  confidenceIntervalSummary: Object.freeze({
    finalEquityP05: 99500,
    finalEquityP50: 100500,
    finalEquityP95: 102000,
    pnlP05: -500,
    pnlP50: 500,
    pnlP95: 2000,
  }),
  worstCasePathSummary: Object.freeze({ id: 'mc-1', totalPnl: -500, maxDrawdown: 5 }),
  medianPathSummary: Object.freeze({ id: 'mc-50', totalPnl: 500, maxDrawdown: 2 }),
  summary: 'Monte Carlo robust.',
})

describe('historical research reports fail closed', () => {
  it('does not approve persisted legacy robust summaries', () => {
    const result = generateBacktestReport({
      strategyBacktestExecution: backtestExecution, strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: walkForward, strategyMonteCarlo: monteCarlo,
      historicalEvidence: { status: 'AVAILABLE' },
    }, { emitEvent: false })
    expect(result.eventType).toBe(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT)
    expect(result.strategySummary.strategyId).toBe('index-pullback-v1')
    expect(result.evidenceStatus).toBe('UNAVAILABLE')
    expect(result.releaseResearchRecommendation).toBe('UNAVAILABLE')
    expect(result.keyStrengths).toEqual([])
    expect(result.backtestPerformanceSummary.netRealizedPnl).toBeNull()
    expect(result.walkForwardRobustnessSummary.robustnessScore).toBeNull()
    expect(result.monteCarloRiskSummary.probabilityOfProfitability).toBeNull()
    expect(result.normalizedStrategyResearchReport).toMatchObject({ liveOrders: false, brokerageIntegration: false, paperTrading: true, releaseResearchRecommendation: 'UNAVAILABLE' })
  })

  it('does not interpret absent evidence as controlled drawdown or no degradation', () => {
    const result = generateBacktestReport({}, { emitEvent: false })
    expect(result.monteCarloRiskSummary.probabilityOfDrawdownBreach).toBeNull()
    expect(result.keyStrengths).toEqual([])
    expect(result.keyWeaknesses).toContain('POINT_IN_TIME_CONTEXT_UNAVAILABLE')
  })

  it('emits unavailable reports through the existing API', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT, (event) => events.push(event))
    const result = createStrategyBacktestReportGenerator({ eventBus }).generate({ strategyBacktestExecution: backtestExecution })
    expect(events).toEqual([result])
  })
})
