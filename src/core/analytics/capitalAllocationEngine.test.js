import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { demoPortfolio } from '../../data/demoPortfolio.js'
import { evaluatePortfolioRisk } from '../risk/portfolioRiskEngine.js'
import { evaluatePortfolioAnalytics } from './portfolioAnalyticsEngine.js'
import {
  createCapitalAllocationEngine,
  recommendCapitalAllocation,
  PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT,
} from './capitalAllocationEngine.js'

function buildSnapshots(portfolio = demoPortfolio) {
  const risk = evaluatePortfolioRisk(portfolio, { emitEvent: false })
  const analytics = evaluatePortfolioAnalytics(portfolio, {
    emitEvent: false,
    riskSnapshot: risk,
  })

  return { risk, analytics }
}

const strategyAttribution = Object.freeze({
  strategies: Object.freeze([
    Object.freeze({
      strategy: 'Index Pullback',
      trades: 4,
      winRate: 75,
      profitFactor: 2.5,
      expectancy: 220,
      averageLoss: -120,
      netRealizedPnl: 880,
    }),
    Object.freeze({
      strategy: 'Volatility Breakout',
      trades: 3,
      winRate: 33,
      profitFactor: 0.8,
      expectancy: -45,
      averageLoss: -180,
      netRealizedPnl: -135,
    }),
  ]),
})

describe('capitalAllocationEngine', () => {
  it('recommends available capital and risk budget allocation', () => {
    const { risk, analytics } = buildSnapshots()
    const result = recommendCapitalAllocation(demoPortfolio, {
      emitEvent: false,
      riskSnapshot: risk,
      portfolioAnalytics: analytics,
      strategyAttribution,
      targets: {
        reservedCashBufferPct: 10,
        riskBudgetPct: 3,
      },
    })

    expect(result.paperTrading).toBe(true)
    expect(result.eventType).toBe(PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT)
    expect(result.capital.reservedCashBuffer).toBe(12500)
    expect(result.capital.availableCapital).toBe(21750)
    expect(result.capital.totalRiskBudget).toBe(3750)
    expect(result.capital.remainingRiskBudget).toBeGreaterThanOrEqual(0)
  })

  it('allocates capital by strategy using strategy attribution quality', () => {
    const { risk, analytics } = buildSnapshots()
    const result = recommendCapitalAllocation(demoPortfolio, {
      emitEvent: false,
      riskSnapshot: risk,
      portfolioAnalytics: analytics,
      strategyAttribution,
    })

    expect(result.allocation.byStrategy).toHaveLength(2)
    expect(result.allocation.byStrategy[0].strategy).toBe('Index Pullback')
    expect(result.allocation.byStrategy[0].recommendedCapital).toBeGreaterThan(result.allocation.byStrategy[1].recommendedCapital)
    expect(result.allocation.byStrategy[1].allocationState).toBe('underweight')
  })

  it('detects overweight and underweight asset classes', () => {
    const { risk, analytics } = buildSnapshots()
    const result = recommendCapitalAllocation(demoPortfolio, {
      emitEvent: false,
      riskSnapshot: { ...risk, summary: { ...risk.summary, riskLevel: 'controlled' } },
      portfolioAnalytics: analytics,
      targets: {
        assetClass: {
          etf: 15,
          equity: 30,
          crypto: 20,
          forex: 20,
          futures: 15,
        },
      },
    })

    const etf = result.allocation.byAssetClass.find((item) => item.assetType === 'etf')
    const equity = result.allocation.byAssetClass.find((item) => item.assetType === 'equity')

    expect(etf.allocationState).toBe('overweight')
    expect(equity.allocationState).toBe('underweight')
    expect(result.allocationStatus).toBe('caution')
  })

  it('detects symbol-level concentration against the symbol cap', () => {
    const { risk, analytics } = buildSnapshots()
    const result = recommendCapitalAllocation(demoPortfolio, {
      emitEvent: false,
      riskSnapshot: risk,
      portfolioAnalytics: analytics,
      targets: {
        maxSymbolWeightPct: 10,
      },
    })

    expect(result.allocation.bySymbol[0].allocationState).toBe('overweight')
    expect(result.allocation.bySymbol[0].currentWeight).toBeGreaterThan(10)
  })

  it('marks allocation constrained when cash buffer or drawdown protection blocks new capital', () => {
    const portfolio = {
      ...demoPortfolio,
      cash: 5000,
      buyingPower: 5000,
    }
    const { risk, analytics } = buildSnapshots(portfolio)
    const result = recommendCapitalAllocation(portfolio, {
      emitEvent: false,
      riskSnapshot: risk,
      portfolioAnalytics: analytics,
      drawdownProtection: {
        protectionStatus: 'locked',
        eventType: 'portfolio.drawdownProtection.evaluated',
      },
    })

    expect(result.capital.availableCapital).toBe(0)
    expect(result.allocationStatus).toBe('constrained')
    expect(result.recommendations[0]).toContain('Preserve cash')
  })

  it('references upstream analytics, risk, performance, protection, and sizing outputs', () => {
    const { risk, analytics } = buildSnapshots()
    const result = recommendCapitalAllocation(demoPortfolio, {
      emitEvent: false,
      riskSnapshot: risk,
      portfolioAnalytics: analytics,
      performanceSnapshot: { eventType: 'portfolio.performance.evaluated' },
      drawdownProtection: { eventType: 'portfolio.drawdownProtection.evaluated', protectionStatus: 'clear' },
      positionSizing: { eventType: 'trade.positionSize.recommended', status: 'recommended', metrics: { riskPct: 0.5 } },
    })

    expect(result.references).toMatchObject({
      portfolioRiskEvent: 'portfolio.risk.evaluated',
      portfolioAnalyticsEvent: 'portfolio.analytics.updated',
      performanceEvent: 'portfolio.performance.evaluated',
      drawdownProtectionEvent: 'portfolio.drawdownProtection.evaluated',
      positionSizingEvent: 'trade.positionSize.recommended',
    })
    expect(result.recommendations.some((recommendation) => recommendation.includes('Current sizing candidate'))).toBe(true)
  })

  it('emits the capital allocation recommendation event', () => {
    const eventBus = createEventBus()
    const events = []
    const { risk, analytics } = buildSnapshots()

    eventBus.subscribe(PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT, (payload) => events.push(payload))

    const result = createCapitalAllocationEngine({ eventBus }).recommend(demoPortfolio, {
      riskSnapshot: risk,
      portfolioAnalytics: analytics,
      timestamp: '2026-07-03T19:00:00.000Z',
    })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      eventType: PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT,
      timestamp: '2026-07-03T19:00:00.000Z',
      paperTrading: true,
    })
  })
})
