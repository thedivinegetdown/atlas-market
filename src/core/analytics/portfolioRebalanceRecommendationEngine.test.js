import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { demoPortfolio, guardrailDemoPortfolio } from '../../data/demoPortfolio.js'
import { evaluatePortfolioAnalytics } from './portfolioAnalyticsEngine.js'
import {
  PORTFOLIO_REBALANCE_RECOMMENDED_EVENT,
  createPortfolioRebalanceRecommendationEngine,
  recommendPortfolioRebalance,
} from './portfolioRebalanceRecommendationEngine.js'

describe('portfolioRebalanceRecommendationEngine', () => {
  it('recommends reductions for overweight, concentration, cash buffer, and risk conditions', () => {
    const analytics = evaluatePortfolioAnalytics(demoPortfolio, { emitEvent: false })
    const result = recommendPortfolioRebalance(demoPortfolio, {
      emitEvent: false,
      analyticsSnapshot: analytics,
      targets: {
        assetClass: { etf: 20, equity: 20, crypto: 20, forex: 20, futures: 20 },
        cashBufferPct: 35,
        maxGrossExposure: 125,
        maxLeverage: 1.25,
        maxPositionWeight: 25,
      },
    })

    expect(result.eventType).toBe(PORTFOLIO_REBALANCE_RECOMMENDED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.recommendations.map((action) => action.type)).toContain('reduce')
    expect(result.recommendations.some((action) => action.scope === 'symbol' && action.target === 'ES')).toBe(true)
    expect(result.recommendations.some((action) => action.scope === 'cash_buffer')).toBe(true)
    expect(result.recommendations.some((action) => action.target === 'gross_exposure')).toBe(true)
    expect(result.confidence).toBeGreaterThan(0)
    expect(result.rationaleSummary).toContain('recommendation')
  })

  it('detects underweight asset classes and suggests adds', () => {
    const analytics = evaluatePortfolioAnalytics(guardrailDemoPortfolio, { emitEvent: false })
    const result = recommendPortfolioRebalance(guardrailDemoPortfolio, {
      emitEvent: false,
      analyticsSnapshot: analytics,
      targets: {
        assetClass: { etf: 30, equity: 30, crypto: 20, forex: 10, futures: 10 },
        cashBufferPct: 10,
        maxGrossExposure: 90,
        maxLeverage: 1,
      },
    })

    expect(result.recommendations.some((action) => action.type === 'add' && action.target === 'crypto')).toBe(true)
    expect(result.recommendations.some((action) => action.type === 'add' && action.target === 'forex')).toBe(true)
  })

  it('returns hold when allocations are within recommendation guardrails', () => {
    const analytics = evaluatePortfolioAnalytics(guardrailDemoPortfolio, {
      emitEvent: false,
      targets: {
        assetClass: { etf: 77, equity: 23, crypto: 0, forex: 0, futures: 0 },
        maxAssetDriftPct: 30,
        maxSectorDriftPct: 90,
      },
    })
    const result = recommendPortfolioRebalance(guardrailDemoPortfolio, {
      emitEvent: false,
      analyticsSnapshot: {
        ...analytics,
        drift: { hasDrift: false, items: [] },
        riskSnapshot: { ...analytics.riskSnapshot, riskLevel: 'controlled' },
      },
      targets: {
        assetClass: { etf: 77, equity: 23, crypto: 0, forex: 0, futures: 0 },
        cashBufferPct: 5,
        maxGrossExposure: 110,
        maxLeverage: 1.2,
        maxPositionWeight: 90,
      },
    })

    expect(result.recommendations).toHaveLength(1)
    expect(result.recommendations[0].type).toBe('hold')
    expect(result.rationaleSummary).toContain('hold current allocations')
  })

  it('emits portfolio.rebalance.recommended', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_REBALANCE_RECOMMENDED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioRebalanceRecommendationEngine({ eventBus }).recommend(demoPortfolio)

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(PORTFOLIO_REBALANCE_RECOMMENDED_EVENT)
    expect(events[0].confidence).toBe(result.confidence)
  })
})
