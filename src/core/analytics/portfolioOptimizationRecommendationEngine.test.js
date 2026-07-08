import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT,
  createPortfolioOptimizationRecommendationEngine,
  recommendPortfolioOptimization,
} from './portfolioOptimizationRecommendationEngine.js'

const portfolioAnalytics = Object.freeze({
  eventType: 'portfolio.analytics.updated',
  diversification: Object.freeze({ score: 48, label: 'concentrated' }),
  concentration: Object.freeze({
    largestPosition: Object.freeze({ symbol: 'SPY', weight: 34 }),
  }),
  drift: Object.freeze({
    hasDrift: true,
    items: Object.freeze([Object.freeze({ scope: 'sector', name: 'Index', driftPct: 18 })]),
  }),
})

const portfolioCorrelation = Object.freeze({
  eventType: 'portfolio.correlation.evaluated',
  correlationRiskStatus: 'elevated',
  concentrationRiskFromCorrelatedAssets: Object.freeze({
    correlatedWeight: 58,
    highCorrelationPairs: Object.freeze([
      Object.freeze({ left: 'SPY', right: 'QQQ', correlation: 0.92, observations: 30 }),
    ]),
  }),
})

const portfolioFactorExposure = Object.freeze({
  eventType: 'portfolio.factorExposure.evaluated',
  factorRiskStatus: 'elevated',
  volatilityFactorExposure: Object.freeze({ status: 'elevated', exposureScore: 78 }),
  factorConcentrationSummary: Object.freeze({
    elevatedFactors: Object.freeze([
      Object.freeze({ factor: 'market_beta', score: 82, status: 'elevated' }),
      Object.freeze({ factor: 'sector', score: 75, status: 'elevated' }),
    ]),
    cautionFactors: Object.freeze([
      Object.freeze({ factor: 'momentum', score: 64, status: 'caution' }),
    ]),
  }),
})

const capitalAllocation = Object.freeze({
  eventType: 'portfolio.capitalAllocation.recommended',
  allocationStatus: 'caution',
  allocation: Object.freeze({
    byAssetClass: Object.freeze([
      Object.freeze({ assetType: 'etf', allocationState: 'overweight', driftPct: 16 }),
      Object.freeze({ assetType: 'forex', allocationState: 'underweight', driftPct: -8 }),
    ]),
    bySymbol: Object.freeze([
      Object.freeze({ symbol: 'SPY', allocationState: 'overweight', driftPct: 14 }),
    ]),
    byStrategy: Object.freeze([
      Object.freeze({ strategy: 'Index Pullback', allocationScore: 82 }),
    ]),
  }),
})

const portfolioRisk = Object.freeze({
  eventType: 'portfolio.risk.evaluated',
  summary: Object.freeze({
    riskLevel: 'high',
    grossExposure: 118,
    openRiskPct: 2.8,
  }),
})

const performance = Object.freeze({
  eventType: 'portfolio.performance.evaluated',
  metrics: Object.freeze({
    netRealizedPnl: 180,
  }),
})

const strategyAttribution = Object.freeze({
  eventType: 'strategy.attribution.evaluated',
  strategies: Object.freeze([
    Object.freeze({ strategy: 'Index Pullback', trades: 4, profitFactor: 2.1, netRealizedPnl: 220 }),
    Object.freeze({ strategy: 'Crypto Momentum', trades: 2, profitFactor: 0.7, netRealizedPnl: -90 }),
  ]),
})

describe('portfolio optimization recommendation engine', () => {
  it('recommends paper-only optimization actions from reused risk outputs', () => {
    const result = recommendPortfolioOptimization({
      portfolioAnalytics,
      portfolioCorrelation,
      portfolioFactorExposure,
      capitalAllocation,
      portfolioRisk,
      performance,
      strategyAttribution,
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T05:00:00.000Z',
    })

    expect(result.eventType).toBe(PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.liveOrders).toBe(false)
    expect(result.recommendationOnly).toBe(true)
    expect(result.recommendationPriority).toBe('high')
    expect(result.optimizationConfidenceScore).toBeGreaterThan(70)
    expect(result.riskReductionRecommendations.some((item) => item.priority === 'high')).toBe(true)
    expect(result.diversificationRecommendations[0].category).toBe('diversification')
    expect(result.factorExposureAdjustmentRecommendations.some((item) => item.action.includes('market_beta'))).toBe(true)
    expect(result.correlationReductionRecommendations.some((item) => item.action.includes('correlated'))).toBe(true)
    expect(result.capitalAllocationAdjustmentRecommendations.some((item) => item.action.includes('etf'))).toBe(true)
    expect(result.strategyAllocationRecommendations.some((item) => item.action.includes('Crypto Momentum'))).toBe(true)
    expect(result.sourceEvents.portfolioFactorExposure).toBe('portfolio.factorExposure.evaluated')
  })

  it('returns low-priority maintain recommendations when source outputs are stable', () => {
    const result = recommendPortfolioOptimization({
      portfolioAnalytics: {
        eventType: 'portfolio.analytics.updated',
        diversification: { score: 82, label: 'strong' },
        concentration: { largestPosition: { symbol: 'SPY', weight: 18 } },
        drift: { hasDrift: false, items: [] },
      },
      portfolioCorrelation: {
        eventType: 'portfolio.correlation.evaluated',
        correlationRiskStatus: 'clear',
        concentrationRiskFromCorrelatedAssets: { correlatedWeight: 12, highCorrelationPairs: [] },
      },
      portfolioFactorExposure: {
        eventType: 'portfolio.factorExposure.evaluated',
        factorRiskStatus: 'clear',
        volatilityFactorExposure: { status: 'clear', exposureScore: 30 },
        factorConcentrationSummary: { elevatedFactors: [], cautionFactors: [] },
      },
      capitalAllocation: {
        eventType: 'portfolio.capitalAllocation.recommended',
        allocationStatus: 'balanced',
        allocation: { byAssetClass: [], bySymbol: [], byStrategy: [] },
      },
      portfolioRisk: {
        eventType: 'portfolio.risk.evaluated',
        summary: { riskLevel: 'controlled', grossExposure: 80, openRiskPct: 0.7 },
      },
      performance,
      strategyAttribution: {
        eventType: 'strategy.attribution.evaluated',
        strategies: [{ strategy: 'Index Pullback', trades: 4, profitFactor: 2.1, netRealizedPnl: 220 }],
      },
    }, { emitEvent: false })

    expect(result.recommendationPriority).toBe('low')
    expect(result.recommendationSummary.highPriority).toBe(0)
    expect(result.riskReductionRecommendations[0].action).toContain('Maintain')
    expect(result.correlationReductionRecommendations[0].priority).toBe('low')
  })

  it('emits portfolio optimization recommended events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioOptimizationRecommendationEngine({ eventBus }).recommend({
      portfolioAnalytics,
      portfolioCorrelation,
      portfolioFactorExposure,
      capitalAllocation,
      portfolioRisk,
      performance,
      strategyAttribution,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT)
  })
})
