import { beforeEach, describe, expect, it } from 'vitest'
import { handler as cancelPaperOrderHandler } from '../netlify/functions/cancel-paper-order.js'
import { handler as submitPaperOrderHandler } from '../netlify/functions/submit-paper-order.js'
import { getStore, resetStore } from '../lib/repositories/store.js'
import { journalRepository, orderRepository, portfolioRepository } from '../src/hooks/tradingRuntime.js'
import { workspaceApiClient } from '../src/api/workspaceApiClient.js'
import { auth2Body, auth2Headers } from './helpers/auth2Fixtures.js'

const disabledError = {
  code: 'legacy_paper_mutation_disabled',
  message: 'legacy PAPER mutation route is disabled and non-authoritative',
}

function snapshotStore() {
  return JSON.parse(JSON.stringify(getStore()))
}

async function invoke(handler, body, headers = auth2Headers()) {
  const response = await handler({
    httpMethod: 'POST',
    headers,
    body: JSON.stringify(auth2Body(body)),
  })

  return {
    statusCode: response.statusCode,
    payload: JSON.parse(response.body),
  }
}

function callerControlledOrder(overrides = {}) {
  return {
    paperTrading: true,
    symbol: 'AAPL',
    side: 'BUY',
    type: 'MARKET',
    quantity: 25,
    price: 1,
    riskPct: 0,
    cash: 999999999,
    positions: [{ symbol: 'AAPL', quantity: 1000000 }],
    quote: {
      symbol: 'AAPL',
      price: 1,
      updatedAt: '2099-01-01T00:00:00.000Z',
    },
    ...overrides,
  }
}

beforeEach(() => {
  resetStore()
})

describe('Part 11C legacy PAPER mutation containment', () => {
  it('fails closed on submit without changing compatibility financial state', async () => {
    portfolioRepository.create({ id: 'portfolio-1', cash: 100000, exposure: 0.1 })
    journalRepository.create({ id: 'journal-existing', message: 'existing evidence' })
    const before = snapshotStore()

    const response = await invoke(submitPaperOrderHandler, callerControlledOrder())

    expect(response.statusCode).toBe(410)
    expect(response.payload).toEqual({
      ok: false,
      error: { ...disabledError, requestId: expect.any(String) },
    })
    expect(response.payload.data).toBeUndefined()
    expect(getStore()).toEqual(before)
  })

  it('fails closed on cancel without changing compatibility order state', async () => {
    const existing = orderRepository.create({
      id: 'compatibility-order-1',
      symbol: 'AAPL',
      side: 'BUY',
      type: 'LIMIT',
      quantity: 1,
      price: 100,
      state: 'WORKING',
    })
    portfolioRepository.create({ id: 'portfolio-1', cash: 100000, exposure: 0.1 })
    journalRepository.create({ id: 'journal-existing', message: 'existing evidence' })
    const before = snapshotStore()

    const response = await invoke(cancelPaperOrderHandler, { orderId: existing.id })

    expect(response.statusCode).toBe(410)
    expect(response.payload).toEqual({
      ok: false,
      error: { ...disabledError, requestId: expect.any(String) },
    })
    expect(response.payload.data).toBeUndefined()
    expect(getStore()).toEqual(before)
    expect(orderRepository.find(existing.id).state).toBe('WORKING')
  })

  it('preserves authentication and CSRF enforcement before the disabled response', async () => {
    for (const handler of [submitPaperOrderHandler, cancelPaperOrderHandler]) {
      const unauthenticated = await invoke(handler, {}, { 'content-type': 'application/json' })
      const missingCsrf = await invoke(handler, {}, auth2Headers({ csrf: false }))

      expect(unauthenticated.statusCode).toBe(401)
      expect(unauthenticated.payload.error.code).toBe('authentication_required')
      expect(missingCsrf.statusCode).toBe(403)
      expect(missingCsrf.payload.error.code).toBe('csrf_required')
    }
  })

  it('exposes no successful client mutation shape for disabled routes', async () => {
    await expect(workspaceApiClient.submitPaperOrder(callerControlledOrder())).rejects.toMatchObject(disabledError)
    await expect(workspaceApiClient.cancelPaperOrder('compatibility-order-1')).rejects.toMatchObject(disabledError)
    expect(getStore().orders).toEqual([])
    expect(getStore().portfolios).toEqual([])
    expect(getStore().journals).toEqual([])
  })
})
