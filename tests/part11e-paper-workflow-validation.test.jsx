import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { handler as equityCurveHandler } from '../netlify/functions/equity-curve.js'
import { handler as journalSummaryHandler } from '../netlify/functions/journal-summary.js'
import { handler as ordersHandler } from '../netlify/functions/orders.js'
import { handler as portfolioSummaryHandler } from '../netlify/functions/portfolio-summary.js'
import { handler as positionsHandler } from '../netlify/functions/positions.js'
import { handler as submitPaperOrderHandler } from '../netlify/functions/submit-paper-order.js'
import { ASSET_TYPES, getAssetProfileForSymbol, getQuantityLabel } from '../lib/assets/index.js'
import { getStore, resetStore } from '../lib/repositories/store.js'
import { OrderEntryPanel } from '../src/components/OrderEntryPanel.jsx'

const freshQuote = {
  symbol: 'AAPL',
  price: 100,
  updatedAt: new Date().toISOString(),
}

let root = null
let container = null

function renderWithRoot(ui) {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  act(() => {
    root.render(ui)
  })

  return { container }
}

function parseResponse(response) {
  return {
    statusCode: response.statusCode,
    json: JSON.parse(response.body),
  }
}

async function invokePost(handler, body) {
  return parseResponse(await handler({
    httpMethod: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
}

async function invokeGet(handler, queryStringParameters = {}) {
  return parseResponse(await handler({ queryStringParameters }))
}

function validOrder(overrides = {}) {
  return {
    paperTrading: true,
    symbol: 'AAPL',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    price: 100,
    quote: freshQuote,
    ...overrides,
  }
}

beforeEach(() => {
  resetStore()
})

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  container?.remove()
  root = null
  container = null
})

describe('Part 11E end-to-end paper trading workflow validation', () => {
  it('submits a buy market order through API, broker, persistence, positions, portfolio, and journal', async () => {
    const submitted = await invokePost(submitPaperOrderHandler, validOrder())
    const orders = await invokeGet(ordersHandler)
    const positions = await invokeGet(positionsHandler)
    const portfolio = await invokeGet(portfolioSummaryHandler)
    const journal = await invokeGet(journalSummaryHandler)
    const equity = await invokeGet(equityCurveHandler)

    expect(submitted.statusCode).toBe(200)
    expect(submitted.json.data.order).toMatchObject({
      symbol: 'AAPL',
      side: 'BUY',
      type: 'MARKET',
      state: 'FILLED',
      assetType: 'equity',
      quantityLabel: 'share',
    })
    expect(orders.json.data.orders).toHaveLength(1)
    expect(orders.json.data.orders[0].state).toBe('FILLED')
    expect(positions.json.data.positions[0]).toMatchObject({
      symbol: 'AAPL',
      quantity: 1,
      averageCost: 100,
      marketValue: 100,
    })
    expect(portfolio.json.data.summary.cash).toBe(99900)
    expect(portfolio.json.data.summary.accountValue).toBe(100000)
    expect(journal.json.data.entries[0]).toMatchObject({
      symbol: 'AAPL',
      notes: 'BUY AAPL filled at 100',
    })
    expect(equity.json.data.paperTrading).toBe(true)
  })

  it('submits a sell market order and reduces an existing paper position', async () => {
    await invokePost(submitPaperOrderHandler, validOrder({ side: 'BUY' }))
    const sell = await invokePost(submitPaperOrderHandler, validOrder({ side: 'SELL' }))
    const positions = await invokeGet(positionsHandler)
    const portfolio = await invokeGet(portfolioSummaryHandler)
    const journal = await invokeGet(journalSummaryHandler)

    expect(sell.statusCode).toBe(200)
    expect(sell.json.data.order).toMatchObject({
      side: 'SELL',
      state: 'FILLED',
    })
    expect(positions.json.data.positions).toHaveLength(0)
    expect(portfolio.json.data.summary.cash).toBe(100000)
    expect(journal.json.data.entries).toHaveLength(2)
  })

  it('submits a limit order without creating a position until filled', async () => {
    const submitted = await invokePost(submitPaperOrderHandler, validOrder({
      type: 'LIMIT',
      price: 100,
      limitPrice: 100,
    }))
    const orders = await invokeGet(ordersHandler)
    const positions = await invokeGet(positionsHandler)

    expect(submitted.json.data.order.state).toBe('WORKING')
    expect(orders.json.data.orders[0].state).toBe('WORKING')
    expect(positions.json.data.positions).toHaveLength(0)
  })

  it('validates stop and stop-limit order price rules at the API boundary', async () => {
    const stop = await invokePost(submitPaperOrderHandler, validOrder({
      type: 'STOP',
      price: 100,
      stopPrice: 0,
    }))
    const stopLimit = await invokePost(submitPaperOrderHandler, validOrder({
      type: 'STOP_LIMIT',
      price: 100,
      limitPrice: 100,
      stopPrice: 0,
    }))

    expect(stop.statusCode).toBe(400)
    expect(stop.json).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_stop_price',
        message: 'stop price must be greater than zero',
        requestId: expect.any(String),
      },
    })
    expect(stopLimit.statusCode).toBe(400)
    expect(stopLimit.json.error.code).toBe('invalid_stop_price')
  })

  it('rejects invalid symbol, quantity, price, and non-paper trading requests with API error shape', async () => {
    const invalidSymbol = await invokePost(submitPaperOrderHandler, validOrder({ symbol: '../SPY' }))
    const invalidQuantity = await invokePost(submitPaperOrderHandler, validOrder({ quantity: 0 }))
    const invalidPrice = await invokePost(submitPaperOrderHandler, validOrder({ price: 0, quote: { ...freshQuote, price: 0 } }))
    const liveMode = await invokePost(submitPaperOrderHandler, validOrder({ paperTrading: false }))

    for (const response of [invalidSymbol, invalidQuantity, invalidPrice, liveMode]) {
      expect(response.statusCode).toBe(400)
      expect(response.json).toMatchObject({
        ok: false,
        error: {
          code: expect.any(String),
          message: expect.any(String),
        },
      })
    }
    expect(invalidSymbol.json.error.code).toBe('invalid_symbol')
    expect(invalidQuantity.json.error.code).toBe('invalid_number')
    expect(invalidPrice.json.error.code).toBe('invalid_number')
    expect(liveMode.json.error.code).toBe('paper_trading_required')
  })

  it('refreshes related workspace panels after a UI order mutation', async () => {
    const refreshOrders = vi.fn()
    const refreshPositions = vi.fn()
    const refreshPortfolio = vi.fn()
    const refreshEquity = vi.fn()
    const refreshJournal = vi.fn()

    renderWithRoot(
      <OrderEntryPanel
        quote={freshQuote}
        onMutationSuccess={() => {
          refreshOrders()
          refreshPositions()
          refreshPortfolio()
          refreshEquity()
          refreshJournal()
        }}
      />
    )

    await act(async () => {
      const orderSelect = container.querySelector('select[name="orderIntent"]')
      orderSelect.value = 'BUY_MARKET'
      orderSelect.dispatchEvent(new Event('change', { bubbles: true }))
      container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('paper order submitted')
    expect(refreshOrders).toHaveBeenCalledTimes(1)
    expect(refreshPositions).toHaveBeenCalledTimes(1)
    expect(refreshPortfolio).toHaveBeenCalledTimes(1)
    expect(refreshEquity).toHaveBeenCalledTimes(1)
    expect(refreshJournal).toHaveBeenCalledTimes(1)
    expect(getStore().orders[0].state).toBe('FILLED')
  })

  it('preserves the existing equity workflow contract after asset-agnostic changes', async () => {
    const submitted = await invokePost(submitPaperOrderHandler, validOrder({
      type: 'LIMIT',
      quantity: 2,
      price: 100,
      limitPrice: 100,
    }))
    const profile = getAssetProfileForSymbol('AAPL')

    expect(submitted.statusCode).toBe(200)
    expect(submitted.json.data.order).toMatchObject({
      assetType: ASSET_TYPES.EQUITY,
      quantity: 2,
      quantityLabel: 'shares',
      pricePrecision: 2,
      tickSize: 0.01,
      contractMultiplier: 1,
    })
    expect(profile.assetType).toBe(ASSET_TYPES.EQUITY)
    expect(getQuantityLabel(ASSET_TYPES.FOREX, 2000)).toBe('units')
    expect(getQuantityLabel(ASSET_TYPES.FUTURES, 1)).toBe('contract')
  })
})
