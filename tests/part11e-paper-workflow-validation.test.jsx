import { beforeEach, describe, expect, it } from 'vitest'
import { handler as cancelPaperOrderHandler } from '../netlify/functions/cancel-paper-order.js'
import { handler as submitPaperOrderHandler } from '../netlify/functions/submit-paper-order.js'
import { getStore, resetStore } from '../lib/repositories/store.js'
import { journalRepository, orderRepository, portfolioRepository } from '../src/hooks/tradingRuntime.js'
import { auth2Body, auth2Headers } from './helpers/auth2Fixtures.js'

const disabledError = {
  code: 'legacy_paper_mutation_disabled',
  message: 'legacy PAPER mutation route is disabled and non-authoritative',
}

function snapshotStore() {
  return JSON.parse(JSON.stringify(getStore()))
}

async function invoke(handler, body, requestId = 'req-legacy-disabled') {
  const response = await handler({
    httpMethod: 'POST',
    headers: { ...auth2Headers(), 'x-request-id': requestId },
    body: JSON.stringify(auth2Body(body)),
  })
  return { statusCode: response.statusCode, json: JSON.parse(response.body) }
}

function orderPayload(overrides = {}) {
  return {
    paperTrading: true,
    symbol: 'AAPL',
    side: 'BUY',
    type: 'MARKET',
    quantity: 1,
    price: 100,
    riskPct: 1,
    quote: {
      symbol: 'AAPL',
      price: 100,
      updatedAt: new Date().toISOString(),
    },
    ...overrides,
  }
}

beforeEach(() => {
  resetStore()
})

describe('Part 11E fail-closed compatibility workflow', () => {
  it('returns the same explicit disabled contract for every legacy order type', async () => {
    for (const [index, payload] of [
      orderPayload({ type: 'MARKET' }),
      orderPayload({ type: 'LIMIT', limitPrice: 100 }),
      orderPayload({ type: 'STOP', stopPrice: 99 }),
      orderPayload({ type: 'STOP_LIMIT', limitPrice: 100, stopPrice: 99 }),
    ].entries()) {
      const requestId = `req-disabled-${index}`
      const response = await invoke(submitPaperOrderHandler, payload, requestId)

      expect(response).toEqual({
        statusCode: 410,
        json: {
          ok: false,
          error: { ...disabledError, requestId },
        },
      })
    }
    expect(getStore().orders).toEqual([])
    expect(getStore().portfolios).toEqual([])
    expect(getStore().journals).toEqual([])
  })

  it('does not grant caller-controlled price, risk, quote, cash, position, actor, or live authority', async () => {
    const before = snapshotStore()
    const response = await invoke(submitPaperOrderHandler, orderPayload({
      paperTrading: false,
      liveTrading: true,
      brokerExecution: true,
      price: 0.01,
      quantity: 999999,
      riskPct: -100,
      cash: 999999999,
      positions: [{ symbol: 'AAPL', quantity: 999999 }],
      actor: { userId: 'forged-user', role: 'owner' },
      quote: {
        symbol: 'AAPL',
        price: 0.01,
        updatedAt: '2099-01-01T00:00:00.000Z',
      },
    }))

    expect(response.statusCode).toBe(410)
    expect(response.json.error).toEqual({ ...disabledError, requestId: 'req-legacy-disabled' })
    expect(response.json.data).toBeUndefined()
    expect(response.json.order).toBeUndefined()
    expect(response.json.execution).toBeUndefined()
    expect(getStore()).toEqual(before)
  })

  it('does not fill, reduce, close, or cancel pre-existing compatibility state', async () => {
    const existing = orderRepository.create({
      id: 'working-order',
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 2,
      price: 100,
      state: 'WORKING',
    })
    portfolioRepository.create({ id: 'portfolio-1', cash: 100000, exposure: 0.1 })
    journalRepository.create({ id: 'journal-1', message: 'existing journal state' })
    const before = snapshotStore()

    const sell = await invoke(submitPaperOrderHandler, orderPayload({ side: 'SELL', quantity: 2 }))
    const cancel = await invoke(cancelPaperOrderHandler, { orderId: existing.id })

    expect(sell.statusCode).toBe(410)
    expect(cancel.statusCode).toBe(410)
    expect(sell.json.error.code).toBe(disabledError.code)
    expect(cancel.json.error.code).toBe(disabledError.code)
    expect(getStore()).toEqual(before)
    expect(orderRepository.find(existing.id).state).toBe('WORKING')
  })
})
