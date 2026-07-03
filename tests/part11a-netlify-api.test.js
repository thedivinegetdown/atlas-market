import { beforeEach, describe, expect, it } from 'vitest'
import { handler as watchlistHandler } from '../netlify/functions/watchlist.js'
import { handler as marketOverviewHandler } from '../netlify/functions/market-overview.js'
import { handler as signalsHandler } from '../netlify/functions/signals.js'
import { handler as riskSummaryHandler } from '../netlify/functions/risk-summary.js'
import { handler as portfolioSummaryHandler } from '../netlify/functions/portfolio-summary.js'
import { handler as equityCurveHandler } from '../netlify/functions/equity-curve.js'
import { handler as journalSummaryHandler } from '../netlify/functions/journal-summary.js'
import { handler as ordersHandler } from '../netlify/functions/orders.js'
import { handler as positionsHandler } from '../netlify/functions/positions.js'
import { createApiHandler } from '../netlify/functions/_shared/api.js'
import { createJournalRepository } from '../lib/repositories/journalRepository.js'
import { createOrderRepository } from '../lib/repositories/orderRepository.js'
import { createPortfolioRepository } from '../lib/repositories/portfolioRepository.js'
import { resetStore } from '../lib/repositories/store.js'

function parseResponse(response) {
  return {
    ...response,
    json: JSON.parse(response.body),
  }
}

function event(queryStringParameters = {}) {
  return { queryStringParameters }
}

beforeEach(() => {
  resetStore()
})

describe('Part 11A Netlify workspace API', () => {
  it('returns watchlist data using the standard JSON success shape', async () => {
    const response = parseResponse(await watchlistHandler(event()))

    expect(response.statusCode).toBe(200)
    expect(response.json).toMatchObject({
      ok: true,
      data: {
        paperTrading: true,
        quotes: expect.any(Array),
      },
    })
    expect(response.json.data.quotes.length).toBeGreaterThan(0)
  })

  it('returns market overview, signals, and risk summary by symbol', async () => {
    const overview = parseResponse(await marketOverviewHandler(event({ symbol: 'spy' })))
    const signals = parseResponse(await signalsHandler(event({ symbol: 'SPY' })))
    const risk = parseResponse(await riskSummaryHandler(event({ symbol: 'SPY' })))

    expect(overview.json.data.symbol).toBe('SPY')
    expect(overview.json.data.quote.symbol).toBe('SPY')
    expect(signals.json.data.signal.symbol).toBe('SPY')
    expect(risk.json.data.risk.symbol).toBe('SPY')
    expect(risk.json.data.paperTrading).toBe(true)
  })

  it('returns portfolio, equity curve, journal, orders, and positions data', async () => {
    createPortfolioRepository().create({ id: 'portfolio-1', cash: 100000, exposure: 0.1 })
    createJournalRepository().create({
      symbol: 'AAPL',
      strategy: 'Breakout',
      notes: 'Clean continuation',
      result: 'win',
      pnl: 125,
    })
    createOrderRepository().create({
      id: 'order-1',
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      quantity: 2,
      price: 100,
      filledPrice: 100,
      state: 'FILLED',
      pnl: 0,
    })

    const portfolio = parseResponse(await portfolioSummaryHandler(event()))
    const curve = parseResponse(await equityCurveHandler(event()))
    const journal = parseResponse(await journalSummaryHandler(event({ symbol: 'AAPL', result: 'win' })))
    const orders = parseResponse(await ordersHandler(event()))
    const positions = parseResponse(await positionsHandler(event()))

    expect(portfolio.json.data.summary.accountValue).toBeGreaterThan(0)
    expect(curve.json.data.points.length).toBe(2)
    expect(journal.json.data.entries[0].symbol).toBe('AAPL')
    expect(orders.json.data.orders[0].symbol).toBe('AAPL')
    expect(positions.json.data.positions[0]).toMatchObject({
      symbol: 'AAPL',
      quantity: 2,
    })
  })

  it('returns JSON error shape for missing and invalid symbols', async () => {
    const missing = parseResponse(await marketOverviewHandler(event()))
    const invalid = parseResponse(await signalsHandler(event({ symbol: '../SPY' })))

    expect(missing.statusCode).toBe(400)
    expect(missing.json).toMatchObject({
      ok: false,
      error: {
        code: 'missing_symbol',
        message: 'symbol is required',
        requestId: expect.any(String),
      },
    })
    expect(invalid.statusCode).toBe(400)
    expect(invalid.json.error.code).toBe('invalid_symbol')
  })

  it('validates journal filters', async () => {
    const response = parseResponse(await journalSummaryHandler(event({ result: 'unknown' })))

    expect(response.statusCode).toBe(400)
    expect(response.json).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_result',
        message: 'result filter is invalid',
        requestId: expect.any(String),
      },
    })
  })

  it('handles repository or engine failures with the standard error shape', async () => {
    const handler = createApiHandler(({ service }) => service.getOrders(), {
      serviceFactory: () => ({
        async getOrders() {
          throw new Error('repository failed')
        },
      }),
    })

    const response = parseResponse(await handler(event()))

    expect(response.statusCode).toBe(500)
    expect(response.json).toMatchObject({
      ok: false,
      error: {
        code: 'internal_error',
        message: 'request failed',
        requestId: expect.any(String),
      },
    })
  })

  it('keeps paper trading enabled by default across endpoints', async () => {
    const endpoints = [
      watchlistHandler(event()),
      marketOverviewHandler(event({ symbol: 'SPY' })),
      signalsHandler(event({ symbol: 'SPY' })),
      portfolioSummaryHandler(event()),
      ordersHandler(event()),
    ]

    const responses = await Promise.all(endpoints)
    for (const response of responses.map(parseResponse)) {
      expect(response.json.ok).toBe(true)
      expect(response.json.data.paperTrading).toBe(true)
    }
  })
})
