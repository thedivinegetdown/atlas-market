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

describe('strategy backtest report generator', () => {
  it('generates an approval research report from robust paper-only outputs', () => {
    const result = generateBacktestReport({
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: walkForward,
      strategyMonteCarlo: monteCarlo,
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T02:00:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.strategySummary.strategyId).toBe('index-pullback-v1')
    expect(result.backtestPerformanceSummary.netRealizedPnl).toBe(420)
    expect(result.walkForwardRobustnessSummary.status).toBe('robust')
    expect(result.monteCarloRiskSummary.probabilityOfProfitability).toBe(78)
    expect(result.releaseResearchRecommendation).toBe('approve')
    expect(result.keyStrengths).toContain('Walk-forward robustness is classified as robust')
    expect(result.normalizedStrategyResearchReport.liveOrders).toBe(false)
    expect(result.sourceEvents.strategyMonteCarlo).toBe('strategy.monteCarlo.simulated')
  })

  it('revises reports when robustness is mixed but not failed', () => {
    const result = generateBacktestReport({
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: { ...walkForward, finalWalkForwardStatus: 'caution' },
      strategyMonteCarlo: { ...monteCarlo, robustnessClassification: 'caution', probabilityOfProfitability: 58 },
    }, { emitEvent: false })

    expect(result.releaseResearchRecommendation).toBe('revise')
    expect(result.keyWeaknesses).toContain('Walk-forward robustness requires review')
    expect(result.keyWeaknesses).toContain('Monte Carlo simulation requires review')
  })

  it('rejects reports when completed research outputs indicate fragility', () => {
    const result = generateBacktestReport({
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: {
        ...backtestPerformance,
        includedTrades: 0,
        metrics: { ...backtestPerformance.metrics, totalIncludedTrades: 0, netRealizedPnl: -120 },
      },
      strategyWalkForward: { ...walkForward, finalWalkForwardStatus: 'failed' },
      strategyMonteCarlo: { ...monteCarlo, robustnessClassification: 'fragile' },
    }, { emitEvent: false })

    expect(result.releaseResearchRecommendation).toBe('reject')
    expect(result.keyWeaknesses).toContain('No filled simulated paper trades were available for analysis')
    expect(result.keyWeaknesses).toContain('Walk-forward robustness failed')
    expect(result.keyWeaknesses).toContain('Monte Carlo simulation classified the strategy as fragile')
  })

  it('emits strategy backtest report generated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyBacktestReportGenerator({ eventBus }).generate({
      strategyBacktestExecution: backtestExecution,
      strategyBacktestPerformance: backtestPerformance,
      strategyWalkForward: walkForward,
      strategyMonteCarlo: monteCarlo,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_BACKTEST_REPORT_GENERATED_EVENT)
  })
})
