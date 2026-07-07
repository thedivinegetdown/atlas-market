import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { validateStrategyBlueprint } from './strategyBuilderEngine.js'
import { evaluateStrategyRules } from './strategyRuleEvaluationEngine.js'
import { composeStrategySignal } from './strategySignalComposer.js'
import {
  STRATEGY_LIFECYCLE_UPDATED_EVENT,
  createStrategyLifecycleManager,
  updateStrategyLifecycle,
} from './strategyLifecycleManager.js'

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

function buildLifecycleInputs(inputOverrides = {}, blueprintOverrides = {}) {
  const strategyBlueprintValidation = buildStrategyBlueprintValidation(blueprintOverrides)
  const ruleInput = {
    ...context,
    ...inputOverrides,
    strategyBlueprintValidation,
  }
  const strategyRuleEvaluation = evaluateStrategyRules(ruleInput, { emitEvent: false })
  const strategySignalComposition = composeStrategySignal({
    ...ruleInput,
    strategyRuleEvaluation,
  }, { emitEvent: false })

  return {
    ...ruleInput,
    strategyRuleEvaluation,
    strategySignalComposition,
  }
}

describe('strategy lifecycle manager', () => {
  it('promotes eligible paper strategy context to active lifecycle state', () => {
    const result = updateStrategyLifecycle(buildLifecycleInputs(), {
      emitEvent: false,
      timestamp: '2026-07-07T23:00:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_LIFECYCLE_UPDATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.lifecycleState).toBe('active')
    expect(result.activationEligibility.status).toBe('eligible')
    expect(result.validationSnapshot.validationStatus).toBe('valid')
    expect(result.signalComposerSnapshot.signalStatus).toBe('composed')
    expect(result.researchRegimeContextSnapshot.marketRegime.riskRegime).toBe('risk-on')
    expect(result.lifecycleAuditEvent.transition).toBe('draft->active')
  })

  it('keeps valid but blocked strategy context validated instead of activating', () => {
    const result = updateStrategyLifecycle(buildLifecycleInputs({
      assetType: 'crypto',
      marketRegime: {
        ...context.marketRegime,
        riskRegime: { regime: 'risk-off' },
      },
    }), { emitEvent: false })

    expect(result.lifecycleState).toBe('validated')
    expect(result.activationEligibility.status).toBe('blocked')
    expect(result.signalComposerSnapshot.signalStatus).toBe('suppressed')
    expect(result.pauseRecommendation.recommended).toBe(true)
  })

  it('pauses an active paper strategy when exit context is active', () => {
    const result = updateStrategyLifecycle(buildLifecycleInputs({
      previousLifecycleState: 'active',
      researchDecisionContext: {
        ...context.researchDecisionContext,
        decisionBiasSummary: { decisionBias: 'avoid' },
      },
      researchSignalScore: {
        ...context.researchSignalScore,
        decisionBias: 'avoid',
      },
    }), { emitEvent: false })

    expect(result.lifecycleState).toBe('paused')
    expect(result.pauseRecommendation.recommended).toBe(true)
    expect(result.pauseRecommendation.reasons).toContain('Strategy signal composer produced an exit signal')
    expect(result.lifecycleAuditEvent.transition).toBe('active->paused')
  })

  it('honors archive requests while preserving validation and signal snapshots', () => {
    const result = updateStrategyLifecycle({
      ...buildLifecycleInputs(),
      requestedLifecycleState: 'archived',
    }, { emitEvent: false })

    expect(result.lifecycleState).toBe('archived')
    expect(result.archiveRecommendation.recommended).toBe(true)
    expect(result.archiveRecommendation.reasons).toContain('Archive requested by lifecycle input')
    expect(result.validationSnapshot.strategyId).toBe('index-pullback-v1')
    expect(result.signalComposerSnapshot.signalAction).toBe('entry')
  })

  it('emits strategy lifecycle updated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_LIFECYCLE_UPDATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyLifecycleManager({ eventBus }).update(buildLifecycleInputs())

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_LIFECYCLE_UPDATED_EVENT)
  })
})
