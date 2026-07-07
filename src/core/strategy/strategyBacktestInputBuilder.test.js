import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { validateStrategyBlueprint } from './strategyBuilderEngine.js'
import { evaluateStrategyRules } from './strategyRuleEvaluationEngine.js'
import { composeStrategySignal } from './strategySignalComposer.js'
import { updateStrategyLifecycle } from './strategyLifecycleManager.js'
import { updateStrategyRegistry } from './strategyRegistryEngine.js'
import {
  STRATEGY_BACKTEST_INPUT_PREPARED_EVENT,
  createStrategyBacktestInputBuilder,
  prepareStrategyBacktestInput,
} from './strategyBacktestInputBuilder.js'

const context = Object.freeze({
  symbol: 'SPY',
  assetType: 'etf',
  marketDataAdapterHealth: Object.freeze({
    eventType: 'market.dataAdapter.checked',
    metadata: Object.freeze({
      id: 'mock-market-data',
      assetTypes: Object.freeze(['equity', 'etf', 'crypto']),
      paperTrading: true,
    }),
    health: Object.freeze({
      status: 'healthy',
      provider: 'mock-market-data',
      available: true,
      stale: false,
      paperTrading: true,
    }),
  }),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    summary: Object.freeze({ riskLevel: 'moderate', openRiskPct: 1.2 }),
  }),
  positionSizing: Object.freeze({
    eventType: 'trade.positionSize.recommended',
    status: 'recommended',
    suggestedQuantity: 12,
    metrics: Object.freeze({ dollarRisk: 240 }),
  }),
  capitalAllocation: Object.freeze({
    eventType: 'portfolio.capitalAllocation.recommended',
    allocationStatus: 'balanced',
    capital: Object.freeze({
      availableCapital: 125000,
      remainingRiskBudget: 4200,
    }),
  }),
})

function buildRegistry() {
  const strategyBlueprintValidation = validateStrategyBlueprint({
    id: 'index-pullback-v1',
    name: 'Index Pullback',
    version: '1.2.0',
    metadata: {
      tags: ['index', 'research'],
    },
    entryConditions: [
      { id: 'risk-on', type: 'market_regime', operator: 'eq', value: 'risk-on', source: 'market.regime.classified' },
      { id: 'research-score', type: 'research_score', operator: 'gte', value: 60, source: 'research.signalScore.evaluated' },
    ],
    exitConditions: [
      { id: 'avoid-exit', type: 'research_bias', operator: 'eq', value: 'avoid', source: 'research.signalScore.evaluated' },
    ],
    riskRuleReferences: [
      { id: 'position-sizing', engine: 'positionSizingEngine', reference: context.positionSizing.eventType },
      { id: 'portfolio-risk', engine: 'portfolioRiskEngine', reference: context.portfolioRisk.eventType },
    ],
    timeframeReferences: ['swing', 'position'],
    compatibleAssetClasses: ['etf', 'equity'],
    positionSizing: context.positionSizing,
    portfolioRisk: context.portfolioRisk,
    aiDecision: { eventType: 'ai.decision.researchEnhanced' },
    researchEnhancedDecision: { eventType: 'ai.decision.researchEnhanced' },
    marketRegime: { eventType: 'market.regime.classified' },
  }, { emitEvent: false })
  const researchDecisionContext = {
    eventType: 'research.decisionContext.prepared',
    symbol: 'SPY',
    assetType: 'etf',
    researchScoreSummary: { finalResearchScore: 72 },
    decisionBiasSummary: { decisionBias: 'bullish' },
  }
  const researchSignalScore = {
    eventType: 'research.signalScore.evaluated',
    finalResearchScore: 72,
    decisionBias: 'bullish',
  }
  const marketRegime = {
    eventType: 'market.regime.classified',
    symbol: 'SPY',
    assetType: 'etf',
    trendRegime: { regime: 'uptrend' },
    riskRegime: { regime: 'risk-on' },
    regimeConfidenceScore: 70,
  }
  const researchEnhancedDecision = {
    eventType: 'ai.decision.researchEnhanced',
    researchInfluenceScore: 72,
    finalResearchAwareDecisionSummary: { finalDecision: 'approve', confidenceScore: 75 },
  }
  const strategyRuleEvaluation = evaluateStrategyRules({
    ...context,
    strategyBlueprintValidation,
    researchDecisionContext,
    researchSignalScore,
    marketRegime,
    researchEnhancedDecision,
  }, { emitEvent: false })
  const strategySignalComposition = composeStrategySignal({
    ...context,
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    researchDecisionContext,
    researchSignalScore,
    marketRegime,
    researchEnhancedDecision,
  }, { emitEvent: false })
  const strategyLifecycle = updateStrategyLifecycle({
    ...context,
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    strategySignalComposition,
    researchDecisionContext,
    researchSignalScore,
    marketRegime,
    researchEnhancedDecision,
  }, { emitEvent: false })
  const strategyRegistry = updateStrategyRegistry({
    strategyBlueprintValidation,
    strategyLifecycle,
  }, { emitEvent: false })

  return { strategyBlueprintValidation, strategyLifecycle, strategyRegistry }
}

describe('strategy backtest input builder', () => {
  it('prepares a normalized ready backtest request without running a backtest', () => {
    const stack = buildRegistry()
    const result = prepareStrategyBacktestInput({
      ...context,
      ...stack,
      assetUniverse: [{ symbol: 'SPY', assetType: 'etf' }],
      timeframe: 'swing',
      dateRange: { startDate: '2025-01-01', endDate: '2025-06-30' },
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T23:45:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_BACKTEST_INPUT_PREPARED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.readinessStatus).toBe('ready')
    expect(result.normalizedBacktestRequest.selectedStrategySnapshot.strategyId).toBe('index-pullback-v1')
    expect(result.selectedAssetUniverse).toEqual([{ symbol: 'SPY', assetType: 'etf' }])
    expect(result.timeframeSelection.compatible).toBe(true)
    expect(result.initialCapitalConfiguration.initialCapital).toBe(125000)
    expect(result.marketDataAdapterCompatibilityCheck.compatible).toBe(true)
  })

  it('returns caution for short date ranges and stale market data', () => {
    const stack = buildRegistry()
    const result = prepareStrategyBacktestInput({
      ...context,
      ...stack,
      marketDataAdapterHealth: {
        ...context.marketDataAdapterHealth,
        health: {
          ...context.marketDataAdapterHealth.health,
          stale: true,
        },
      },
      dateRange: { startDate: '2025-06-01', endDate: '2025-06-10' },
    }, { emitEvent: false })

    expect(result.readinessStatus).toBe('caution')
    expect(result.cautions).toContain('Market data adapter health is stale')
    expect(result.cautions).toContain('Backtest date range is short for strategy review')
  })

  it('blocks unsupported timeframe, invalid dates, inactive strategy, and incompatible adapter assets', () => {
    const stack = buildRegistry()
    const result = prepareStrategyBacktestInput({
      ...context,
      ...stack,
      strategyRegistry: {
        ...stack.strategyRegistry,
        registryRecord: {
          ...stack.strategyRegistry.registryRecord,
          status: 'paused',
        },
      },
      assetUniverse: [{ symbol: 'BTC', assetType: 'crypto' }],
      timeframe: 'intraday',
      dateRange: { startDate: '2025-07-01', endDate: '2025-06-01' },
      marketDataAdapterHealth: {
        ...context.marketDataAdapterHealth,
        metadata: {
          ...context.marketDataAdapterHealth.metadata,
          assetTypes: ['equity', 'etf'],
        },
      },
    }, { emitEvent: false })

    expect(result.readinessStatus).toBe('blocked')
    expect(result.blockers).toContain('Selected strategy is not active in the paper registry')
    expect(result.blockers).toContain('Selected timeframe is not supported by strategy')
    expect(result.blockers).toContain('Backtest start date must be before end date')
    expect(result.blockers).toContain('Market data adapter is not compatible with selected asset universe')
  })

  it('emits strategy backtest input prepared events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BACKTEST_INPUT_PREPARED_EVENT, (payload) => events.push(payload))
    const stack = buildRegistry()

    const result = createStrategyBacktestInputBuilder({ eventBus }).prepare({
      ...context,
      ...stack,
      assetUniverse: [{ symbol: 'SPY', assetType: 'etf' }],
      timeframe: 'swing',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_BACKTEST_INPUT_PREPARED_EVENT)
  })
})
