import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { validateStrategyBlueprint } from './strategyBuilderEngine.js'
import { evaluateStrategyRules } from './strategyRuleEvaluationEngine.js'
import { composeStrategySignal } from './strategySignalComposer.js'
import { updateStrategyLifecycle } from './strategyLifecycleManager.js'
import {
  STRATEGY_REGISTRY_UPDATED_EVENT,
  createStrategyRegistryEngine,
  updateStrategyRegistry,
} from './strategyRegistryEngine.js'

const context = Object.freeze({
  symbol: 'SPY',
  assetType: 'etf',
  timeframe: 'swing',
  researchDecisionContext: Object.freeze({
    eventType: 'research.decisionContext.prepared',
    symbol: 'SPY',
    assetType: 'etf',
    researchScoreSummary: Object.freeze({ finalResearchScore: 76 }),
    decisionBiasSummary: Object.freeze({ decisionBias: 'bullish' }),
  }),
  researchSignalScore: Object.freeze({
    eventType: 'research.signalScore.evaluated',
    finalResearchScore: 76,
    decisionBias: 'bullish',
  }),
  researchEnhancedDecision: Object.freeze({
    eventType: 'ai.decision.researchEnhanced',
    researchInfluenceScore: 73,
    finalResearchAwareDecisionSummary: Object.freeze({
      finalDecision: 'approve',
      confidenceScore: 78,
    }),
  }),
  marketRegime: Object.freeze({
    eventType: 'market.regime.classified',
    symbol: 'SPY',
    assetType: 'etf',
    trendRegime: Object.freeze({ regime: 'uptrend' }),
    riskRegime: Object.freeze({ regime: 'risk-on' }),
    compositeRegimeLabel: 'uptrend/normal/risk-on/healthy',
    regimeConfidenceScore: 72,
  }),
  portfolioRisk: Object.freeze({
    eventType: 'portfolio.risk.evaluated',
    summary: Object.freeze({ riskLevel: 'moderate' }),
  }),
  positionSizing: Object.freeze({
    eventType: 'trade.positionSize.recommended',
    status: 'recommended',
  }),
  tradeGuardrail: Object.freeze({
    eventType: 'trade.guardrail.evaluated',
  }),
})

function buildLifecycle(overrides = {}) {
  const strategyBlueprintValidation = validateStrategyBlueprint({
    id: 'index-pullback-v1',
    name: 'Index Pullback',
    version: '1.2.0',
    metadata: {
      owner: 'Atlas Research Desk',
      description: 'Reusable paper index pullback strategy.',
      tags: ['index', 'pullback', 'research'],
    },
    entryConditions: [
      { id: 'risk-on', type: 'market_regime', operator: 'eq', value: 'risk-on', source: 'market.regime.classified' },
      { id: 'research-score', type: 'research_score', operator: 'gte', value: 60, source: 'research.signalScore.evaluated' },
    ],
    exitConditions: [
      { id: 'avoid-exit', type: 'research_bias', operator: 'eq', value: 'avoid', source: 'research.signalScore.evaluated' },
    ],
    riskRuleReferences: [
      { id: 'trade-guardrail', engine: 'tradeGuardrailEngine', reference: 'trade.guardrail.evaluated' },
      { id: 'position-sizing', engine: 'positionSizingEngine', reference: 'trade.positionSize.recommended' },
    ],
    timeframeReferences: ['swing', 'position'],
    compatibleAssetClasses: ['etf', 'equity'],
    aiDecision: context.researchEnhancedDecision,
    researchEnhancedDecision: context.researchEnhancedDecision,
    marketRegime: context.marketRegime,
    portfolioRisk: context.portfolioRisk,
    positionSizing: context.positionSizing,
    ...overrides.blueprint,
  }, { emitEvent: false })
  const strategyRuleEvaluation = evaluateStrategyRules({
    ...context,
    strategyBlueprintValidation,
    ...overrides.ruleInput,
  }, { emitEvent: false })
  const strategySignalComposition = composeStrategySignal({
    ...context,
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    ...overrides.signalInput,
  }, { emitEvent: false })
  const strategyLifecycle = updateStrategyLifecycle({
    ...context,
    strategyBlueprintValidation,
    strategyRuleEvaluation,
    strategySignalComposition,
    previousLifecycleState: 'validated',
    ...overrides.lifecycleInput,
  }, { emitEvent: false })

  return { strategyBlueprintValidation, strategyLifecycle }
}

describe('strategy registry engine', () => {
  it('normalizes a lifecycle-backed strategy registry record for paper library reuse', () => {
    const { strategyBlueprintValidation, strategyLifecycle } = buildLifecycle()
    const result = updateStrategyRegistry({
      strategyBlueprintValidation,
      strategyLifecycle,
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T23:30:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_REGISTRY_UPDATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.registryRecord).toMatchObject({
      strategyId: 'index-pullback-v1',
      strategyName: 'Index Pullback',
      versionReference: '1.2.0',
      status: 'active',
      active: true,
      paperTrading: true,
    })
    expect(result.registryRecord.tags).toEqual(['index', 'pullback', 'research'])
    expect(result.registryRecord.compatibleAssetClasses).toEqual(['etf', 'equity'])
    expect(result.registryRecord.timeframeReferences).toEqual(['swing', 'position'])
  })

  it('builds a strategy library collection with active lookup and filters', () => {
    const { strategyBlueprintValidation, strategyLifecycle } = buildLifecycle()
    const result = updateStrategyRegistry({
      strategyBlueprintValidation,
      strategyLifecycle,
      existingRecords: [
        {
          strategyId: 'crypto-breakout-v1',
          strategyName: 'Crypto Breakout',
          versionReference: '0.4.0',
          status: 'paused',
          lifecycleState: 'paused',
          validationStatus: 'valid',
          compatibleAssetClasses: ['crypto'],
          timeframeReferences: ['intraday'],
          tags: ['crypto', 'momentum'],
          paperTrading: true,
        },
      ],
      filters: {
        status: 'active',
        assetClass: 'etf',
        timeframe: 'swing',
        tag: 'research',
      },
    }, { emitEvent: false })

    expect(result.strategyLibraryCollection.totalStrategies).toBe(2)
    expect(result.activeStrategyCount).toBe(1)
    expect(result.activeStrategyLookup['index-pullback-v1'].strategyName).toBe('Index Pullback')
    expect(result.strategyLibraryCollection.statusFilteredStrategies).toHaveLength(1)
    expect(result.strategyLibraryCollection.assetClassFilteredStrategies).toHaveLength(1)
    expect(result.strategyLibraryCollection.timeframeFilteredStrategies).toHaveLength(1)
    expect(result.strategyLibraryCollection.tagFilteredStrategies).toHaveLength(1)
    expect(result.strategyLibraryCollection.statusCounts).toMatchObject({ active: 1, paused: 1 })
  })

  it('replaces existing records by strategy id instead of duplicating versions in the registry', () => {
    const { strategyBlueprintValidation, strategyLifecycle } = buildLifecycle()
    const result = updateStrategyRegistry({
      strategyBlueprintValidation,
      strategyLifecycle,
      existingRecords: [
        {
          strategyId: 'index-pullback-v1',
          strategyName: 'Index Pullback',
          versionReference: '1.1.0',
          status: 'validated',
          lifecycleState: 'validated',
          validationStatus: 'valid',
          compatibleAssetClasses: ['etf'],
          timeframeReferences: ['swing'],
          tags: ['index'],
          paperTrading: true,
        },
      ],
    }, { emitEvent: false })

    expect(result.strategyLibraryCollection.records).toHaveLength(1)
    expect(result.strategyLibraryCollection.records[0].versionReference).toBe('1.2.0')
    expect(result.strategyLibraryCollection.records[0].status).toBe('active')
  })

  it('emits strategy registry updated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_REGISTRY_UPDATED_EVENT, (payload) => events.push(payload))
    const { strategyBlueprintValidation, strategyLifecycle } = buildLifecycle()

    const result = createStrategyRegistryEngine({ eventBus }).update({
      strategyBlueprintValidation,
      strategyLifecycle,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_REGISTRY_UPDATED_EVENT)
  })
})
