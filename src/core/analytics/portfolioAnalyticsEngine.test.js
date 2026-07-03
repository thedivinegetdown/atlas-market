import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { demoPortfolio, accountingDemoPortfolio } from '../../data/demoPortfolio.js'
import {
  PORTFOLIO_ANALYTICS_UPDATED_EVENT,
  createPortfolioAnalyticsEngine,
  evaluatePortfolioAnalytics,
} from './portfolioAnalyticsEngine.js'

describe('portfolioAnalyticsEngine', () => {
  it('evaluates asset, sector, symbol, long, short, gross, net, and leverage exposure', () => {
    const result = evaluatePortfolioAnalytics(demoPortfolio, { emitEvent: false })

    expect(result.eventType).toBe(PORTFOLIO_ANALYTICS_UPDATED_EVENT)
    expect(result.paperTrading).toBe(true)
    expect(result.exposure.byAssetClass.length).toBeGreaterThan(1)
    expect(result.exposure.bySector.length).toBeGreaterThan(1)
    expect(result.exposure.bySymbol.length).toBeGreaterThan(1)
    expect(result.exposure.longMarketValue).toBeGreaterThan(0)
    expect(result.exposure.shortMarketValue).toBeGreaterThan(0)
    expect(result.exposure.grossExposure).toBeGreaterThan(0)
    expect(result.exposure.netExposure).toBeDefined()
    expect(result.exposure.leverage).toBeGreaterThan(0)
  })

  it('produces concentration and diversification analysis', () => {
    const result = evaluatePortfolioAnalytics(demoPortfolio, { emitEvent: false })

    expect(result.concentration.largestPosition.symbol).toBe('ES')
    expect(result.concentration.topHoldings.length).toBeGreaterThan(0)
    expect(result.diversification.score).toBeGreaterThanOrEqual(0)
    expect(result.diversification.label).toMatch(/strong|moderate|concentrated/)
    expect(result.insights.length).toBeGreaterThan(0)
  })

  it('detects portfolio drift against target allocations', () => {
    const result = evaluatePortfolioAnalytics(demoPortfolio, {
      emitEvent: false,
      targets: {
        assetClass: { etf: 20, equity: 20, crypto: 20, forex: 20, futures: 20 },
        maxAssetDriftPct: 5,
        maxSectorDriftPct: 10,
      },
    })

    expect(result.drift.hasDrift).toBe(true)
    expect(result.drift.items.length).toBeGreaterThan(0)
    expect(result.drift.items[0]).toMatchObject({
      scope: expect.any(String),
      name: expect.any(String),
      driftPct: expect.any(Number),
    })
  })

  it('accepts paper accounting update shaped input', () => {
    const result = evaluatePortfolioAnalytics({
      portfolioId: 'accounting-output',
      account: { equity: 100000, cash: 50000, buyingPower: 50000 },
      positions: accountingDemoPortfolio.positions,
    }, { emitEvent: false })

    expect(result.portfolioId).toBe('accounting-output')
    expect(result.account.accountValue).toBe(100000)
    expect(result.exposure.bySymbol.length).toBe(accountingDemoPortfolio.positions.length)
  })

  it('emits portfolio.analytics.updated', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_ANALYTICS_UPDATED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioAnalyticsEngine({ eventBus }).evaluate(demoPortfolio)

    expect(events).toHaveLength(1)
    expect(events[0].eventType).toBe(PORTFOLIO_ANALYTICS_UPDATED_EVENT)
    expect(events[0].diversification.score).toBe(result.diversification.score)
  })
})
