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

describe('historical execution capability boundary', () => {
  it('rejects a previously executable blueprint instead of sharing future research/risk context', () => {
    const result = executeStrategyBacktest(buildExecutionInput(), { emitEvent: false })
    expect(result.backtestExecutionStatus).toBe('blocked')
    expect(result.evidenceStatus).toBe('UNAVAILABLE')
    expect(result.strategyRuleEvaluations).toEqual([])
    expect(result.strategySignalCompositions).toEqual([])
    expect(result.simulatedPaperTrades).toEqual([])
    expect(result.historicalEvidence.blockers).toContain('POINT_IN_TIME_CONTEXT_UNAVAILABLE')
  })

  it('future candle and shared-context mutations cannot create earlier decisions or fills', () => {
    const first = executeStrategyBacktest(buildExecutionInput(), { emitEvent: false })
    const changed = structuredClone(candles)
    changed[2] = { ...changed[2], open: 1000, high: 3000, low: 1, close: 2000, volume: 999999999 }
    const second = executeStrategyBacktest(buildExecutionInput({
      historicalReplay: buildHistoricalReplay(1, changed),
      researchSignalScore: { finalResearchScore: 100 },
      portfolioRisk: { summary: { riskLevel: 'low' } },
    }), { emitEvent: false })
    for (const key of ['replayStepConsumption', 'strategyRuleEvaluations', 'strategySignalCompositions', 'simulatedPaperTrades', 'historicalEvidence']) expect(second[key]).toEqual(first[key])
    // This proves rejection invariance, not a successful prefix-only strategy run.
    expect(first.replayStepConsumption).toEqual([])
  })

  it('does not use the signal close or invent an executable timestamp from a daily label', () => {
    const result = executeStrategyBacktest(buildExecutionInput({ historicalReplay: buildHistoricalReplay(2) }), { emitEvent: false })
    expect(result.historicalEvidence).toMatchObject({ signalTimestamp: null, executionTimestamp: null, executionPrice: null })
    expect(result.historicalEvidence.blockers).toContain('EXECUTABLE_SESSION_TIMESTAMPS_UNAVAILABLE')
    expect(result.simulatedPaperTrades).toEqual([])
  })

  it.each(['BREAKOUT.1', 'RANGE.1', 'VOL.1', 'EDGE.2', 'index-pullback-v1', 'breakout-momentum-v1', 'range-mean-reversion-v1', 'volatility-expansion-v1', 'unknown'])('rejects unsupported historical %s without generic stops', (strategyId) => {
    const result = executeStrategyBacktest(buildExecutionInput({
      strategyBacktestInput: { selectedStrategySnapshot: { strategyId }, readinessStatus: 'ready' },
      historicalEvidence: { status: 'AVAILABLE' },
      strategyPolicy: { supported: true },
    }), { emitEvent: false })
    expect(result.session.strategyId).toBe(strategyId)
    expect(result.evidenceStatus).toBe('UNAVAILABLE')
    expect(result.simulatedPaperTrades).toEqual([])
  })

  it('fails closed with missing candles, missing costs, or caller-attested split/dividend semantics', () => {
    for (const input of [{}, buildExecutionInput({ historicalReplay: buildHistoricalReplay(0, []) }), buildExecutionInput({ corporateActions: { splits: 'adjusted', dividends: 'reinvested' }, costs: { fees: 0, slippageBps: 0 } })]) {
      const result = executeStrategyBacktest(input, { emitEvent: false })
      expect(result.historicalEvidence.blockers).toContain('CORPORATE_ACTION_ACCOUNTING_UNAVAILABLE')
      expect(result.historicalEvidence.costs).toBeNull()
      expect(result.evidenceStatus).toBe('UNAVAILABLE')
    }
  })

  it('emits unavailable status through the existing API', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_EXECUTED_EVENT, (event) => events.push(event))
    const result = createStrategyBacktestExecutionEngine({ eventBus }).execute(buildExecutionInput())
    expect(events).toEqual([result])
  })
})
