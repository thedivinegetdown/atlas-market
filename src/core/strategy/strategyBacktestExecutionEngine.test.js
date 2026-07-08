import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { prepareHistoricalReplayStep } from '../../../lib/market/historicalMarketReplayEngine.js'
import { validateStrategyBlueprint } from './strategyBuilderEngine.js'
import {
  STRATEGY_BACKTEST_EXECUTED_EVENT,
  createStrategyBacktestExecutionEngine,
  executeStrategyBacktest,
} from './strategyBacktestExecutionEngine.js'

const portfolioRisk = Object.freeze({
  eventType: 'portfolio.risk.evaluated',
  account: Object.freeze({
    accountValue: 100000,
    cash: 100000,
    buyingPower: 100000,
  }),
  summary: Object.freeze({
    riskLevel: 'moderate',
    openRisk: 0,
    openRiskPct: 0,
  }),
})

const positionSizing = Object.freeze({
  eventType: 'trade.positionSize.recommended',
  status: 'recommended',
  suggestedQuantity: 3,
})

const tradeGuardrail = Object.freeze({
  eventType: 'trade.guardrail.evaluated',
})

const researchDecisionContext = Object.freeze({
  eventType: 'research.decisionContext.prepared',
  symbol: 'SPY',
  assetType: 'etf',
  researchScoreSummary: Object.freeze({ finalResearchScore: 72 }),
  decisionBiasSummary: Object.freeze({ decisionBias: 'bullish' }),
})

const researchSignalScore = Object.freeze({
  eventType: 'research.signalScore.evaluated',
  finalResearchScore: 72,
  decisionBias: 'bullish',
})

const researchEnhancedDecision = Object.freeze({
  eventType: 'ai.decision.researchEnhanced',
  finalResearchAwareDecisionSummary: Object.freeze({
    finalDecision: 'approve',
    confidenceScore: 74,
  }),
  researchInfluenceScore: 70,
})

const marketRegime = Object.freeze({
  eventType: 'market.regime.classified',
  symbol: 'SPY',
  assetType: 'etf',
  trendRegime: Object.freeze({ regime: 'uptrend' }),
  riskRegime: Object.freeze({ regime: 'risk-on' }),
  regimeConfidenceScore: 70,
})

const candles = Object.freeze([
  Object.freeze({ symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-01T00:00:00.000Z', open: 100, high: 102, low: 99, close: 101, volume: 1000000 }),
  Object.freeze({ symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-02T00:00:00.000Z', open: 101, high: 103, low: 100, close: 102, volume: 1100000 }),
  Object.freeze({ symbol: 'SPY', assetType: 'etf', timestamp: '2025-01-03T00:00:00.000Z', open: 102, high: 104, low: 101, close: 103, volume: 1200000 }),
])

function buildStrategyBlueprintValidation() {
  return validateStrategyBlueprint({
    id: 'index-pullback-v1',
    name: 'Index Pullback',
    entryConditions: [
      { id: 'risk-on', type: 'market_regime', operator: 'eq', value: 'risk-on', source: 'market.regime.classified' },
      { id: 'research-score', type: 'research_score', operator: 'gte', value: 60, source: 'research.signalScore.evaluated' },
    ],
    exitConditions: [
      { id: 'avoid-exit', type: 'research_bias', operator: 'eq', value: 'avoid', source: 'research.signalScore.evaluated' },
    ],
    riskRuleReferences: [
      { id: 'guardrail', engine: 'tradeGuardrailEngine', reference: tradeGuardrail.eventType },
      { id: 'position-sizing', engine: 'positionSizingEngine', reference: positionSizing.eventType },
      { id: 'portfolio-risk', engine: 'portfolioRiskEngine', reference: portfolioRisk.eventType },
    ],
    timeframeReferences: ['swing', 'position'],
    compatibleAssetClasses: ['etf', 'equity'],
    aiDecision: researchEnhancedDecision,
    researchEnhancedDecision,
    marketRegime,
    portfolioRisk,
    positionSizing,
  }, { emitEvent: false })
}

function buildBacktestInput() {
  return {
    eventType: 'strategy.backtestInput.prepared',
    readinessStatus: 'ready',
    selectedStrategySnapshot: {
      strategyId: 'index-pullback-v1',
      strategyName: 'Index Pullback',
      status: 'active',
    },
    normalizedBacktestRequest: {
      requestId: 'index-pullback-v1-swing-2025-01-01-2025-01-03',
      selectedStrategySnapshot: {
        strategyId: 'index-pullback-v1',
        strategyName: 'Index Pullback',
      },
      selectedAssetUniverse: [{ symbol: 'SPY', assetType: 'etf' }],
      timeframeSelection: {
        timeframe: 'swing',
        supportedTimeframes: ['swing', 'position'],
        compatible: true,
      },
      dateRange: {
        startDate: '2025-01-01',
        endDate: '2025-01-03',
      },
      initialCapitalConfiguration: {
        initialCapital: 100000,
      },
    },
    initialCapitalConfiguration: {
      initialCapital: 100000,
    },
  }
}

function buildHistoricalReplay(cursorIndex = 1, replayCandles = candles) {
  return prepareHistoricalReplayStep({
    strategyBacktestInput: buildBacktestInput(),
    historicalCandles: replayCandles,
    cursorIndex,
    now: '2025-01-04T00:00:00.000Z',
  }, { emitEvent: false })
}

function buildExecutionInput(overrides = {}) {
  return {
    strategyBlueprintValidation: buildStrategyBlueprintValidation(),
    strategyBacktestInput: buildBacktestInput(),
    historicalReplay: buildHistoricalReplay(),
    researchDecisionContext,
    researchSignalScore,
    researchEnhancedDecision,
    marketRegime,
    portfolioRisk,
    positionSizing,
    tradeGuardrail,
    paperPortfolio: {
      id: 'paper-backtest-test',
      cash: 100000,
      accountValue: 100000,
      buyingPower: 100000,
      positions: [],
      realizedPnl: 0,
    },
    ...overrides,
  }
}

describe('strategy backtest execution engine', () => {
  it('runs strategy rules and signal composition across consumed replay candles', () => {
    const result = executeStrategyBacktest(buildExecutionInput(), {
      emitEvent: false,
      timestamp: '2026-07-08T00:00:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_BACKTEST_EXECUTED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.backtestExecutionStatus).toBe('running')
    expect(result.replayStepConsumption).toHaveLength(2)
    expect(result.strategyRuleEvaluations).toHaveLength(2)
    expect(result.strategySignalCompositions).toHaveLength(2)
    expect(result.simulatedPaperTrades).toHaveLength(2)
    expect(result.simulatedPaperTrades[0].executionSimulation.finalStatus).toBe('filled')
    expect(result.executionSummary.filledTrades).toBe(2)
  })

  it('marks the session completed when the replay cursor reaches the end', () => {
    const result = executeStrategyBacktest(buildExecutionInput({
      historicalReplay: buildHistoricalReplay(2),
    }), { emitEvent: false })

    expect(result.backtestExecutionStatus).toBe('completed')
    expect(result.session.consumedCandles).toBe(3)
    expect(result.executionSummary.generatedTrades).toBe(3)
  })

  it('blocks execution when backtest input or replay output is blocked', () => {
    const inputBlocked = executeStrategyBacktest(buildExecutionInput({
      strategyBacktestInput: {
        ...buildBacktestInput(),
        readinessStatus: 'blocked',
      },
    }), { emitEvent: false })
    const replayBlocked = executeStrategyBacktest(buildExecutionInput({
      historicalReplay: buildHistoricalReplay(0, []),
    }), { emitEvent: false })

    expect(inputBlocked.backtestExecutionStatus).toBe('blocked')
    expect(inputBlocked.reason).toBe('Backtest input readiness is blocked')
    expect(replayBlocked.backtestExecutionStatus).toBe('blocked')
    expect(replayBlocked.reason).toBe('Historical replay step is blocked')
  })

  it('emits strategy backtest executed events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_EXECUTED_EVENT, (payload) => events.push(payload))

    const result = createStrategyBacktestExecutionEngine({ eventBus }).execute(buildExecutionInput())

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_BACKTEST_EXECUTED_EVENT)
  })
})
