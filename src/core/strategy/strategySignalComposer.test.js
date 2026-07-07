import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { validateStrategyBlueprint } from './strategyBuilderEngine.js'
import { evaluateStrategyRules } from './strategyRuleEvaluationEngine.js'
import {
  STRATEGY_SIGNAL_COMPOSED_EVENT,
  composeStrategySignal,
  createStrategySignalComposer,
} from './strategySignalComposer.js'

const context = Object.freeze({
  symbol: 'SPY',
  assetType: 'etf',
  timeframe: 'swing',
  researchDecisionContext: Object.freeze({
    eventType: 'research.decisionContext.prepared',
    symbol: 'SPY',
    assetType: 'etf',
    researchScoreSummary: Object.freeze({ finalResearchScore: 74 }),
    decisionBiasSummary: Object.freeze({ decisionBias: 'bullish' }),
  }),
  researchSignalScore: Object.freeze({
    eventType: 'research.signalScore.evaluated',
    finalResearchScore: 74,
    decisionBias: 'bullish',
  }),
  researchEnhancedDecision: Object.freeze({
    eventType: 'ai.decision.researchEnhanced',
    researchInfluenceScore: 71,
    finalResearchAwareDecisionSummary: Object.freeze({
      finalDecision: 'approve',
      confidenceScore: 76,
    }),
  }),
  marketRegime: Object.freeze({
    eventType: 'market.regime.classified',
    symbol: 'SPY',
    assetType: 'etf',
    trendRegime: Object.freeze({ regime: 'uptrend' }),
    riskRegime: Object.freeze({ regime: 'risk-on' }),
    regimeConfidenceScore: 68,
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

function buildStrategyBlueprintValidation(overrides = {}) {
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
    ...overrides,
  }, { emitEvent: false })
}

function buildRuleEvaluation(inputOverrides = {}, blueprintOverrides = {}) {
  const strategyBlueprintValidation = buildStrategyBlueprintValidation(blueprintOverrides)
  return evaluateStrategyRules({
    ...context,
    ...inputOverrides,
    strategyBlueprintValidation,
  }, { emitEvent: false })
}

describe('strategy signal composer', () => {
  it('composes a normalized bullish entry signal from eligible strategy rules', () => {
    const strategyBlueprintValidation = buildStrategyBlueprintValidation()
    const strategyRuleEvaluation = buildRuleEvaluation()
    const result = composeStrategySignal({
      ...context,
      strategyBlueprintValidation,
      strategyRuleEvaluation,
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T22:00:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_SIGNAL_COMPOSED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.signalStatus).toBe('composed')
    expect(result.normalizedStrategySignal).toMatchObject({
      strategyId: 'index-pullback-v1',
      symbol: 'SPY',
      assetType: 'etf',
      signalAction: 'entry',
      signalDirection: 'bullish',
      paperTrading: true,
      compatibleWithAIDecisionOrchestrator: true,
    })
    expect(result.entrySignalComposition.active).toBe(true)
    expect(result.exitSignalComposition.active).toBe(false)
    expect(result.signalStrengthScore).toBeGreaterThan(60)
    expect(result.confidenceScore).toBeGreaterThan(60)
    expect(result.sourceRuleReferences.map((rule) => rule.id)).toContain('risk-on')
  })

  it('composes an exit signal when exit rules are active', () => {
    const strategyBlueprintValidation = buildStrategyBlueprintValidation()
    const strategyRuleEvaluation = buildRuleEvaluation({
      researchDecisionContext: {
        ...context.researchDecisionContext,
        decisionBiasSummary: { decisionBias: 'avoid' },
      },
      researchSignalScore: {
        ...context.researchSignalScore,
        decisionBias: 'avoid',
      },
    })
    const result = composeStrategySignal({
      ...context,
      strategyBlueprintValidation,
      strategyRuleEvaluation,
      researchDecisionContext: {
        ...context.researchDecisionContext,
        decisionBiasSummary: { decisionBias: 'avoid' },
      },
      researchSignalScore: {
        ...context.researchSignalScore,
        decisionBias: 'avoid',
      },
    }, { emitEvent: false })

    expect(result.signalStatus).toBe('composed')
    expect(result.normalizedStrategySignal.signalAction).toBe('exit')
    expect(result.exitSignalComposition.active).toBe(true)
    expect(result.sourceRuleReferences.map((rule) => rule.id)).toContain('avoid-exit')
  })

  it('suppresses signals for blocked rule evaluations', () => {
    const strategyBlueprintValidation = buildStrategyBlueprintValidation()
    const strategyRuleEvaluation = buildRuleEvaluation({
      assetType: 'crypto',
      marketRegime: {
        ...context.marketRegime,
        riskRegime: { regime: 'risk-off' },
      },
    })
    const result = composeStrategySignal({
      ...context,
      assetType: 'crypto',
      strategyBlueprintValidation,
      strategyRuleEvaluation,
    }, { emitEvent: false })

    expect(result.signalStatus).toBe('suppressed')
    expect(result.normalizedStrategySignal.signalAction).toBe('none')
    expect(result.normalizedStrategySignal.signalDirection).toBe('neutral')
    expect(result.signalStrengthScore).toBe(0)
    expect(result.normalizedStrategySignal.compatibleWithAIDecisionOrchestrator).toBe(false)
  })

  it('emits strategy signal composed events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_SIGNAL_COMPOSED_EVENT, (payload) => events.push(payload))

    const result = createStrategySignalComposer({ eventBus }).compose({
      ...context,
      strategyBlueprintValidation: buildStrategyBlueprintValidation(),
      strategyRuleEvaluation: buildRuleEvaluation(),
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_SIGNAL_COMPOSED_EVENT)
  })
})
