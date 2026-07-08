import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT,
  createPortfolioFactorExposureEngine,
  evaluatePortfolioFactorExposure,
} from './portfolioFactorExposureEngine.js'

const portfolioAnalytics = Object.freeze({
  eventType: 'portfolio.analytics.updated',
  exposure: Object.freeze({
    bySymbol: Object.freeze([
      Object.freeze({ symbol: 'SPY', assetType: 'etf', sector: 'Index', weight: 35 }),
      Object.freeze({ symbol: 'AAPL', assetType: 'equity', sector: 'Technology', weight: 25 }),
      Object.freeze({ symbol: 'BTC-USD', assetType: 'crypto', sector: 'Digital Assets', weight: 20 }),
    ]),
    bySector: Object.freeze([
      Object.freeze({ name: 'Index', weight: 35, count: 1 }),
      Object.freeze({ name: 'Technology', weight: 25, count: 1 }),
      Object.freeze({ name: 'Digital Assets', weight: 20, count: 1 }),
    ]),
    byAssetClass: Object.freeze([
      Object.freeze({ assetType: 'etf', weight: 35, count: 1 }),
      Object.freeze({ assetType: 'equity', weight: 25, count: 1 }),
      Object.freeze({ assetType: 'crypto', weight: 20, count: 1 }),
    ]),
  }),
})

const portfolioCorrelation = Object.freeze({
  eventType: 'portfolio.correlation.evaluated',
  sectorCorrelationSummary: Object.freeze([
    Object.freeze({ sector: 'Index', weight: 35, averageInternalCorrelation: 0 }),
    Object.freeze({ sector: 'Technology', weight: 25, averageInternalCorrelation: 0 }),
    Object.freeze({ sector: 'Digital Assets', weight: 20, averageInternalCorrelation: 0 }),
  ]),
})

const strategyAttribution = Object.freeze({
  eventType: 'strategy.attribution.evaluated',
  strategies: Object.freeze([
    Object.freeze({
      strategy: 'Index Pullback',
      symbols: Object.freeze(['SPY']),
      trades: 4,
      winRate: 75,
      netRealizedPnl: 240,
      profitFactor: 2.2,
      expectancy: 60,
    }),
    Object.freeze({
      strategy: 'Crypto Momentum',
      symbols: Object.freeze(['BTC-USD']),
      trades: 3,
      winRate: 33,
      netRealizedPnl: -90,
      profitFactor: 0.6,
      expectancy: -30,
    }),
  ]),
})

const marketRegime = Object.freeze({
  eventType: 'market.regime.classified',
  trendRegime: Object.freeze({ regime: 'uptrend' }),
  volatilityRegime: Object.freeze({ regime: 'elevated' }),
  riskRegime: Object.freeze({ regime: 'neutral' }),
})

const backtestPerformance = Object.freeze({
  eventType: 'strategy.backtestPerformance.evaluated',
  metrics: Object.freeze({
    netRealizedPnl: 200,
  }),
})

const factorInputs = Object.freeze([
  Object.freeze({ symbol: 'SPY', beta: 1, volatility: 1.2, momentumScore: 68 }),
  Object.freeze({ symbol: 'AAPL', beta: 1.25, volatility: 1.9, momentumScore: 72 }),
  Object.freeze({ symbol: 'BTC-USD', beta: 0, volatility: 4.5, momentumScore: 82 }),
])

describe('portfolio factor exposure engine', () => {
  it('evaluates common market factor exposures from existing portfolio outputs', () => {
    const result = evaluatePortfolioFactorExposure({
      portfolioAnalytics,
      portfolioCorrelation,
      strategyAttribution,
      marketRegime,
      strategyBacktestPerformance: backtestPerformance,
      factorInputs,
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T04:00:00.000Z',
    })

    expect(result.eventType).toBe(PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.marketBetaExposure.weightedBeta).toBeGreaterThan(0)
    expect(result.momentumFactorExposure.weightedMomentumScore).toBeGreaterThan(60)
    expect(result.volatilityFactorExposure.highVolatilityWeight).toBe(20)
    expect(result.sectorFactorExposure.dominantSector.sector).toBe('Index')
    expect(result.assetClassFactorExposure.dominantFactor.assetType).toBe('etf')
    expect(result.strategyFactorExposure.strategyCount).toBe(2)
    expect(result.factorRiskStatus).toMatch(/clear|caution|elevated/)
    expect(result.sourceEvents.portfolioCorrelation).toBe('portfolio.correlation.evaluated')
  })

  it('raises factor risk when multiple factor concentrations are elevated', () => {
    const result = evaluatePortfolioFactorExposure({
      portfolioAnalytics: {
        ...portfolioAnalytics,
        exposure: {
          bySymbol: [
            { symbol: 'SPY', assetType: 'etf', sector: 'Index', weight: 70 },
            { symbol: 'AAPL', assetType: 'equity', sector: 'Index', weight: 20 },
          ],
          bySector: [{ name: 'Index', weight: 90, count: 2 }],
          byAssetClass: [{ assetType: 'etf', weight: 70, count: 1 }, { assetType: 'equity', weight: 20, count: 1 }],
        },
      },
      portfolioCorrelation: {
        ...portfolioCorrelation,
        sectorCorrelationSummary: [{ sector: 'Index', weight: 90, averageInternalCorrelation: 0.9 }],
      },
      strategyAttribution,
      marketRegime: {
        ...marketRegime,
        volatilityRegime: { regime: 'extreme' },
        riskRegime: { regime: 'risk-off' },
      },
      strategyBacktestPerformance: backtestPerformance,
      factorInputs: [
        { symbol: 'SPY', beta: 1.5, volatility: 2.4, momentumScore: 85 },
        { symbol: 'AAPL', beta: 1.4, volatility: 2.2, momentumScore: 80 },
      ],
    }, { emitEvent: false })

    expect(result.factorRiskStatus).toBe('elevated')
    expect(result.factorConcentrationSummary.elevatedFactors.length).toBeGreaterThanOrEqual(2)
  })

  it('emits portfolio factor exposure evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioFactorExposureEngine({ eventBus }).evaluate({
      portfolioAnalytics,
      portfolioCorrelation,
      strategyAttribution,
      marketRegime,
      strategyBacktestPerformance: backtestPerformance,
      factorInputs,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT)
  })
})
