import { describe, expect, it } from 'vitest'
import { createEventBus } from '../../../lib/core/eventBus.js'
import { demoPortfolio } from '../../data/demoPortfolio.js'
import {
  PORTFOLIO_RISK_EVALUATED_EVENT,
  createPortfolioRiskEngine,
  evaluatePortfolioRisk,
} from './portfolioRiskEngine.js'

describe('portfolioRiskEngine', () => {
  it('evaluates an asset-agnostic paper portfolio', () => {
    const result = evaluatePortfolioRisk(demoPortfolio, { emitEvent: false, timestamp: '2026-07-03T14:00:00Z' })

    expect(result.paperTrading).toBe(true)
    expect(result.eventType).toBe(PORTFOLIO_RISK_EVALUATED_EVENT)
    expect(result.summary.riskScore).toBeGreaterThanOrEqual(0)
    expect(result.summary.grossExposure).toBeGreaterThan(0)
    expect(result.positions.map((position) => position.assetType)).toEqual(expect.arrayContaining(['etf', 'equity', 'crypto', 'forex', 'futures']))
    expect(result.assetExposure.length).toBeGreaterThan(1)
    expect(result.recommendations.length).toBeGreaterThan(0)
  })

  it('emits portfolio.risk.evaluated with the risk snapshot', () => {
    const eventBus = createEventBus()
    const events = []
    eventBus.subscribe(PORTFOLIO_RISK_EVALUATED_EVENT, (payload) => events.push(payload))

    const result = createPortfolioRiskEngine({ eventBus }).evaluate(demoPortfolio)

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      eventType: PORTFOLIO_RISK_EVALUATED_EVENT,
      paperTrading: true,
      portfolioId: 'paper-risk-demo',
    })
    expect(events[0].summary.riskScore).toBe(result.summary.riskScore)
  })

  it('flags concentrated and over-levered portfolios', () => {
    const result = evaluatePortfolioRisk({
      id: 'concentrated',
      accountValue: 100000,
      cash: 5000,
      drawdownPct: 14,
      positions: [
        {
          symbol: 'NVDA',
          assetType: 'equity',
          side: 'long',
          quantity: 350,
          currentPrice: 300,
          volatility: 4,
          liquidityScore: 90,
          stopPrice: 270,
        },
      ],
    }, { emitEvent: false })

    expect(result.summary.riskLevel).toMatch(/high|critical/)
    expect(result.warnings).toEqual(expect.arrayContaining([
      'NVDA exceeds max position weight',
      'Drawdown exceeds configured limit',
    ]))
  })

  it('keeps empty paper portfolios controlled', () => {
    const result = evaluatePortfolioRisk({ accountValue: 100000, cash: 100000, positions: [] }, { emitEvent: false })

    expect(result.summary.riskLevel).toBe('controlled')
    expect(result.summary.grossExposure).toBe(0)
    expect(result.positions).toEqual([])
    expect(result.recommendations).toContain('Portfolio has no open positions')
  })
})
