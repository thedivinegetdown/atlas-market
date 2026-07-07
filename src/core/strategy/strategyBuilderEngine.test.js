import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  STRATEGY_BLUEPRINT_VALIDATED_EVENT,
  createStrategyBuilderEngine,
  validateStrategyBlueprint,
} from './strategyBuilderEngine.js'

const baseBlueprint = Object.freeze({
  id: 'index-pullback-v1',
  name: 'Index Pullback',
  version: '1.0.0',
  metadata: Object.freeze({
    owner: 'Atlas Desk',
    description: 'Paper-only index pullback blueprint',
    tags: Object.freeze(['index', 'pullback']),
  }),
  entryConditions: Object.freeze([
    Object.freeze({
      id: 'regime-risk-on',
      type: 'market_regime',
      operator: 'eq',
      value: 'risk-on',
      source: 'market.regime.classified',
    }),
    Object.freeze({
      id: 'research-bullish',
      type: 'research_bias',
      operator: 'eq',
      value: 'bullish',
      source: 'ai.decision.researchEnhanced',
    }),
  ]),
  exitConditions: Object.freeze([
    Object.freeze({
      id: 'research-neutral',
      type: 'research_bias',
      operator: 'in',
      value: ['neutral', 'avoid'],
      source: 'research.signalScore.evaluated',
    }),
  ]),
  riskRuleReferences: Object.freeze([
    Object.freeze({
      id: 'max-risk-per-trade',
      engine: 'tradeGuardrailEngine',
      reference: 'maxRiskPerTradePct',
      required: true,
    }),
    Object.freeze({
      id: 'position-size-cap',
      engine: 'positionSizingEngine',
      reference: 'maxPositionValuePct',
      required: true,
    }),
  ]),
  timeframeReferences: Object.freeze(['intraday', 'swing']),
  compatibleAssetClasses: Object.freeze(['etf', 'equity']),
  aiDecision: Object.freeze({ eventType: 'ai.decision.researchEnhanced' }),
  researchEnhancedDecision: Object.freeze({ eventType: 'ai.decision.researchEnhanced' }),
  marketRegime: Object.freeze({ eventType: 'market.regime.classified' }),
  portfolioRisk: Object.freeze({ eventType: 'portfolio.risk.evaluated' }),
  positionSizing: Object.freeze({ eventType: 'trade.positionSize.recommended' }),
})

describe('strategy builder engine', () => {
  it('normalizes and validates a reusable paper strategy blueprint', () => {
    const result = validateStrategyBlueprint(baseBlueprint, {
      emitEvent: false,
      timestamp: '2026-07-07T20:00:00.000Z',
    })

    expect(result.eventType).toBe(STRATEGY_BLUEPRINT_VALIDATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.validationStatus).toBe('valid')
    expect(result.blueprint).toMatchObject({
      id: 'index-pullback-v1',
      name: 'Index Pullback',
      version: '1.0.0',
      paperTrading: true,
      compatibleAssetClasses: ['etf', 'equity'],
      timeframeReferences: ['intraday', 'swing'],
    })
    expect(result.blueprint.references).toMatchObject({
      aiDecisionEvent: 'ai.decision.researchEnhanced',
      researchEvent: 'ai.decision.researchEnhanced',
      marketRegimeEvent: 'market.regime.classified',
      portfolioRiskEvent: 'portfolio.risk.evaluated',
      positionSizingEvent: 'trade.positionSize.recommended',
    })
  })

  it('returns caution when optional references are missing but the blueprint is usable', () => {
    const result = validateStrategyBlueprint({
      ...baseBlueprint,
      riskRuleReferences: [],
      aiDecision: null,
      researchEnhancedDecision: null,
      marketRegime: null,
      portfolioRisk: null,
      positionSizing: null,
    }, { emitEvent: false })

    expect(result.validationStatus).toBe('caution')
    expect(result.cautions).toContain('No risk rule references supplied')
    expect(result.cautions).toContain('AI decision output is not referenced')
    expect(result.blockers).toEqual([])
  })

  it('returns invalid when required condition and timeframe definitions are missing or unsupported', () => {
    const result = validateStrategyBlueprint({
      ...baseBlueprint,
      entryConditions: [],
      exitConditions: [
        {
          id: 'unsupported',
          type: 'live_broker_fill',
          operator: 'eq',
          value: 'filled',
        },
      ],
      timeframeReferences: ['weekly'],
    }, { emitEvent: false })

    expect(result.validationStatus).toBe('invalid')
    expect(result.blockers).toContain('entry conditions are required')
    expect(result.blockers).toContain('exit condition unsupported uses unsupported type live_broker_fill')
    expect(result.blockers).toContain('Unsupported timeframe reference detected')
  })

  it('normalizes fallback metadata for asset-agnostic blueprints', () => {
    const result = validateStrategyBlueprint({
      entryConditions: [{ type: 'research_score', operator: 'gte', value: 60 }],
      exitConditions: [{ type: 'risk_state', operator: 'eq', value: 'risk-off' }],
      assetType: 'crypto',
    }, { emitEvent: false })

    expect(result.blueprint.id).toBe('strategy-blueprint')
    expect(result.blueprint.name).toBe('Untitled Strategy Blueprint')
    expect(result.blueprint.compatibleAssetClasses).toEqual(['crypto'])
    expect(result.blueprint.timeframeReferences).toEqual(['swing'])
  })

  it('emits strategy blueprint validated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(STRATEGY_BLUEPRINT_VALIDATED_EVENT, (payload) => events.push(payload))

    const result = createStrategyBuilderEngine({ eventBus }).validate(baseBlueprint)

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(STRATEGY_BLUEPRINT_VALIDATED_EVENT)
  })
})
