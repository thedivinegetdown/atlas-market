import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { validateStrategyBlueprint } from './strategyBuilderEngine.js'
import {
  STRATEGY_RULES_EVALUATED_EVENT,
  createStrategyRuleEvaluationEngine,
  evaluateStrategyRules,
} from './strategyRuleEvaluationEngine.js'

const context = Object.freeze({
  symbol: 'SPY',
  assetType: 'etf',
  timeframe: 'swing',
  researchDecisionContext: Object.freeze({
    eventType: 'research.decisionContext.prepared',
    symbol: 'SPY',
    assetType: 'etf',
    researchScoreSummary: Object.freeze({ finalResearchScore: 72 }),
    decisionBiasSummary: Object.freeze({ decisionBias: 'bullish' }),
    marketContextSummary: Object.freeze({
      trend: Object.freeze({ direction: 'uptrend' }),
      riskSentiment: Object.freeze({ label: 'risk-on' }),
    }),
  }),
  researchSignalScore: Object.freeze({
    eventType: 'research.signalScore.evaluated',
    finalResearchScore: 72,
    decisionBias: 'bullish',
  }),
  researchEnhancedDecision: Object.freeze({
    eventType: 'ai.decision.researchEnhanced',
    finalResearchAwareDecisionSummary: Object.freeze({ finalDecision: 'approve' }),
  }),
  marketRegime: Object.freeze({
    eventType: 'market.regime.classified',
    symbol: 'SPY',
    assetType: 'etf',
    trendRegime: Object.freeze({ regime: 'uptrend' }),
    riskRegime: Object.freeze({ regime: 'risk-on' }),
    compositeRegimeLabel: 'uptrend/normal/risk-on/healthy',
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
  multiTimeframeContext: Object.freeze({
    eventType: 'research.multiTimeframeContext.evaluated',
    dominantTimeframeBias: Object.freeze({ bias: 'bullish', dominantBucket: 'swing' }),
  }),
})

function buildValidation(overrides = {}) {
  return validateStrategyBlueprint({
    id: 'index-pullback-v1',
    name: 'Index Pullback',
    entryConditions: [
      { id: 'risk-on', type: 'market_regime', operator: 'in', value: ['risk-on', 'neutral'], source: 'market.regime.classified' },
      { id: 'research-score', type: 'research_score', operator: 'gte', value: 55, source: 'research.signalScore.evaluated' },
      { id: 'ai-approval', type: 'ai_decision', operator: 'in', value: ['approve', 'watchlist'], source: 'ai.decision.researchEnhanced' },
    ],
    exitConditions: [
      { id: 'avoid-exit', type: 'research_bias', operator: 'eq', value: 'avoid', source: 'research.signalScore.evaluated' },
    ],
    riskRuleReferences: [
      { id: 'trade-guardrail', engine: 'tradeGuardrailEngine', reference: 'trade.guardrail.evaluated' },
      { id: 'position-sizing', engine: 'positionSizingEngine', reference: 'trade.positionSize.recommended' },
      { id: 'portfolio-risk', engine: 'portfolioRiskEngine', reference: 'portfolio.risk.evaluated' },
    ],
    timeframeReferences: ['intraday', 'swing', 'position'],
    compatibleAssetClasses: ['equity', 'etf'],
    aiDecision: context.researchEnhancedDecision,
    researchEnhancedDecision: context.researchEnhancedDecision,
    marketRegime: context.marketRegime,
    portfolioRisk: context.portfolioRisk,
    positionSizing: context.positionSizing,
    ...overrides,
  }, {
    emitEvent: false,
    timestamp: '2026-07-07T21:00:00.000Z',
  })
}

describe('strategy rule evaluation engine', () => {
  it('evaluates a valid blueprint as eligible when entry and risk rules pass', () => {
    const strategyBlueprintValidation = buildValidation()
    const result = evaluateStrategyRules({
      ...context,
      strategyBlueprintValidation,
    }, {
      emitEvent: false,
      timestamp: '2026-07-07T21:05:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_RULES_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.strategyEvaluationStatus).toBe('eligible')
    expect(result.entryRuleEvaluation.status).toBe('pass')
    expect(result.exitRuleEvaluation.status).toBe('fail')
    expect(result.riskRuleEvaluation.status).toBe('pass')
    expect(result.timeframeCompatibility.status).toBe('pass')
    expect(result.assetClassCompatibility.status).toBe('pass')
    expect(result.blockers).toEqual([])
  })

  it('blocks paper strategy eligibility when required compatibility or entry rules fail', () => {
    const strategyBlueprintValidation = buildValidation()
    const result = evaluateStrategyRules({
      ...context,
      strategyBlueprintValidation,
      assetType: 'crypto',
      timeframe: 'position',
      marketRegime: {
        ...context.marketRegime,
        riskRegime: { regime: 'risk-off' },
      },
    }, { emitEvent: false })

    expect(result.strategyEvaluationStatus).toBe('blocked')
    expect(result.entryRuleEvaluation.status).toBe('fail')
    expect(result.assetClassCompatibility.status).toBe('fail')
    expect(result.blockers).toContain('One or more entry rules failed')
    expect(result.blockers).toContain('Asset class is not compatible with the blueprint')
  })

  it('routes active exit rules to watchlist instead of duplicating execution logic', () => {
    const strategyBlueprintValidation = buildValidation()
    const result = evaluateStrategyRules({
      ...context,
      strategyBlueprintValidation,
      researchDecisionContext: {
        ...context.researchDecisionContext,
        decisionBiasSummary: { decisionBias: 'avoid' },
      },
      researchSignalScore: {
        ...context.researchSignalScore,
        decisionBias: 'avoid',
      },
    }, { emitEvent: false })

    expect(result.strategyEvaluationStatus).toBe('watchlist')
    expect(result.exitRuleEvaluation.status).toBe('pass')
    expect(result.cautions).toContain('One or more exit rules are active')
  })

  it('emits strategy rule evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_RULES_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyRuleEvaluationEngine({ eventBus }).evaluate({
      ...context,
      strategyBlueprintValidation: buildValidation(),
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_RULES_EVALUATED_EVENT)
  })
})
