import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import {
  PORTFOLIO_CORRELATION_EVALUATED_EVENT,
  createPortfolioCorrelationEngine,
  evaluatePortfolioCorrelation,
} from './portfolioCorrelationEngine.js'

const portfolioAnalytics = Object.freeze({
  eventType: 'portfolio.analytics.updated',
  exposure: Object.freeze({
    bySymbol: Object.freeze([
      Object.freeze({ symbol: 'SPY', assetType: 'etf', sector: 'Index', weight: 35, marketValue: 35000 }),
      Object.freeze({ symbol: 'QQQ', assetType: 'etf', sector: 'Index', weight: 30, marketValue: 30000 }),
      Object.freeze({ symbol: 'GLD', assetType: 'commodity', sector: 'Metals', weight: 15, marketValue: 15000 }),
    ]),
    bySector: Object.freeze([
      Object.freeze({ name: 'Index', weight: 65, count: 2 }),
      Object.freeze({ name: 'Metals', weight: 15, count: 1 }),
    ]),
  }),
  concentration: Object.freeze({
    largestPosition: Object.freeze({ symbol: 'SPY', sector: 'Index', weight: 35 }),
  }),
  diversification: Object.freeze({
    score: 72,
    label: 'moderate',
  }),
})

const strategyAttribution = Object.freeze({
  eventType: 'strategy.attribution.evaluated',
  strategies: Object.freeze([
    Object.freeze({
      strategy: 'Index Pullback',
      symbols: Object.freeze(['SPY', 'QQQ']),
      trades: 4,
      winRate: 75,
      netRealizedPnl: 240,
      profitFactor: 2,
      expectancy: 60,
    }),
    Object.freeze({
      strategy: 'Metals Hedge',
      symbols: Object.freeze(['GLD']),
      trades: 2,
      winRate: 50,
      netRealizedPnl: -40,
      profitFactor: 0.8,
      expectancy: -20,
    }),
  ]),
})

const backtestPerformance = Object.freeze({
  eventType: 'strategy.backtestPerformance.evaluated',
  metrics: Object.freeze({
    netRealizedPnl: 200,
  }),
})

const historicalPriceSeries = Object.freeze({
  SPY: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 100 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 102 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 104 }),
    Object.freeze({ timestamp: '2025-01-04T00:00:00.000Z', close: 106 }),
  ]),
  QQQ: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 200 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 204 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 208 }),
    Object.freeze({ timestamp: '2025-01-04T00:00:00.000Z', close: 212 }),
  ]),
  GLD: Object.freeze([
    Object.freeze({ timestamp: '2025-01-01T00:00:00.000Z', close: 180 }),
    Object.freeze({ timestamp: '2025-01-02T00:00:00.000Z', close: 179 }),
    Object.freeze({ timestamp: '2025-01-03T00:00:00.000Z', close: 178 }),
    Object.freeze({ timestamp: '2025-01-04T00:00:00.000Z', close: 177 }),
  ]),
})

describe('portfolio correlation engine', () => {
  it('evaluates asset correlations and correlated concentration risk', () => {
    const result = evaluatePortfolioCorrelation({
      portfolioAnalytics,
      strategyAttribution,
      strategyBacktestPerformance: backtestPerformance,
      historicalPriceSeries,
      historicalReplay: { eventType: 'market.replay.stepPrepared' },
    }, {
      emitEvent: false,
      timestamp: '2026-07-08T03:00:00.000Z',
    })

    const spyRow = result.assetCorrelationMatrix.find((row) => row.symbol === 'SPY')
    const qqqCorrelation = spyRow.correlations.find((item) => item.symbol === 'QQQ')

    expect(result.eventType).toBe(PORTFOLIO_CORRELATION_EVALUATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.assetCorrelationMatrix).toHaveLength(3)
    expect(qqqCorrelation.correlation).toBeGreaterThan(0.99)
    expect(result.concentrationRiskFromCorrelatedAssets.correlatedSymbolCount).toBeGreaterThanOrEqual(2)
    expect(result.correlationRiskStatus).toMatch(/clear|caution|elevated/)
    expect(result.sourceEvents.portfolioAnalytics).toBe('portfolio.analytics.updated')
  })

  it('summarizes strategy correlation context without recalculating attribution', () => {
    const result = evaluatePortfolioCorrelation({
      portfolioAnalytics,
      strategyAttribution,
      strategyBacktestPerformance: backtestPerformance,
      historicalPriceSeries,
    }, { emitEvent: false })

    expect(result.strategyCorrelationSummary.strategyCount).toBe(2)
    expect(result.strategyCorrelationSummary.alignedStrategies).toBe(1)
    expect(result.strategyCorrelationSummary.divergentStrategies).toBe(1)
    expect(result.strategyCorrelationSummary.strategies[0]).toMatchObject({
      strategy: 'Index Pullback',
      pnlAlignment: 'aligned',
    })
  })

  it('reports sparse matrix coverage when historical series are missing', () => {
    const result = evaluatePortfolioCorrelation({
      portfolioAnalytics,
      strategyAttribution,
      strategyBacktestPerformance: backtestPerformance,
    }, { emitEvent: false })

    const spyRow = result.assetCorrelationMatrix.find((row) => row.symbol === 'SPY')
    const qqqCorrelation = spyRow.correlations.find((item) => item.symbol === 'QQQ')

    expect(qqqCorrelation.correlation).toBeNull()
    expect(qqqCorrelation.observations).toBe(0)
    expect(result.diversificationImpactSummary.correlationAdjustedDiversificationScore).toBeGreaterThan(0)
  })

  it('emits portfolio correlation evaluated events', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_CORRELATION_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioCorrelationEngine({ eventBus }).evaluate({
      portfolioAnalytics,
      strategyAttribution,
      strategyBacktestPerformance: backtestPerformance,
      historicalPriceSeries,
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0].eventType).toBe(PORTFOLIO_CORRELATION_EVALUATED_EVENT)
  })
})
