import { describe, expect, it } from 'vitest'
import { createPortfolioEngine } from '../lib/portfolio/portfolioEngine.js'
import { calculateRealizedPnl, calculateUnrealizedPnl } from '../lib/portfolio/pnlEngine.js'
import { createPerformanceEngine } from '../lib/analytics/performanceEngine.js'
import { createEquityCurveEngine } from '../lib/analytics/equityCurveEngine.js'
import { createJournalEngine } from '../lib/journal/journalEngine.js'

describe('portfolio and analytics', () => {
  it('updates positions after a buy fill', () => {
    const engine = createPortfolioEngine()
    const state = engine.buildState({
      cash: 1000,
      fills: [{ symbol: 'AAPL', side: 'BUY', quantity: 2, fillPrice: 100 }],
    })

    expect(state.openPositions[0].quantity).toBe(2)
    expect(state.buyingPower).toBe(800)
  })

  it('calculates realized pnl after a sell fill', () => {
    const pnl = calculateRealizedPnl([{ side: 'SELL', quantity: 3, fillPrice: 120, avgCost: 100 }])
    expect(pnl).toBe(60)
  })

  it('calculates unrealized pnl from current quotes', () => {
    const pnl = calculateUnrealizedPnl([{ symbol: 'AAPL', quantity: 2, averageCost: 100 }], { AAPL: { price: 110 } })
    expect(pnl).toBe(20)
  })

  it('summarizes performance stats from journal rows', () => {
    const performance = createPerformanceEngine().summarize([
      { pnl: 25 },
      { pnl: -10 },
      { pnl: 15 },
    ])

    expect(performance.tradeCount).toBe(3)
    expect(performance.winRate).toBe(2 / 3)
  })

  it('computes max drawdown from an equity curve', () => {
    const curve = createEquityCurveEngine()
    const drawdown = curve.calculateMaxDrawdown([1000, 1200, 900, 1100, 800])
    expect(drawdown).toBe(33.33)
  })

  it('creates journal entries with the requested shape', () => {
    const journal = createJournalEngine().createEntry({
      orderId: 'order-1',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: 2,
      fillPrice: 100,
      thesis: 'Momentum is improving',
      tags: ['watchlist'],
      pnl: 0,
    })

    expect(journal).toMatchObject({
      journalId: expect.any(String),
      orderId: 'order-1',
      symbol: 'AAPL',
      side: 'BUY',
      quantity: 2,
      fillPrice: 100,
      thesis: 'Momentum is improving',
      tags: ['watchlist'],
      pnl: 0,
      createdAt: expect.any(String),
    })
  })
})
