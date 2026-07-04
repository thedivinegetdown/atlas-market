import { describe, expect, it } from 'vitest'
import { createEventBus } from '../core/eventBus.js'
import {
  BROKER_ADAPTER_CHECKED_EVENT,
  createBrokerAdapter,
  createBrokerAdapterInterface,
  createMockPaperBrokerAdapter,
  normalizeBrokerAccount,
  normalizeBrokerPosition,
  normalizeOrderRequest,
  normalizeSimulatedOrderResponse,
} from './brokerAdapter.js'

describe('broker adapter foundation', () => {
  it('validates the broker adapter interface', () => {
    expect(() => createBrokerAdapterInterface({ getAccount() {} })).toThrow('broker adapter missing methods')

    const adapter = createMockPaperBrokerAdapter()
    expect(createBrokerAdapterInterface(adapter)).toBe(adapter)
  })

  it('uses the mock paper broker adapter as default', async () => {
    const adapter = createBrokerAdapter()
    const account = await adapter.getAccount({ id: 'paper-test', cash: 50000, equity: 52000, buyingPower: 50000 })

    expect(adapter.metadata.default).toBe(true)
    expect(adapter.metadata.paperTrading).toBe(true)
    expect(adapter.metadata.liveOrders).toBe(false)
    expect(account.ok).toBe(true)
    expect(account.provider).toBe('mock-paper-broker-adapter')
    expect(account.data).toMatchObject({
      accountId: 'paper-test',
      paperTrading: true,
      cash: 50000,
      equity: 52000,
    })
  })

  it('normalizes accounts and positions for asset-agnostic consumers', () => {
    expect(normalizeBrokerAccount({
      id: 'acct-1',
      cash: '1000.25',
      accountValue: '1250.75',
      buyingPower: '900',
    }, 'test-broker')).toMatchObject({
      accountId: 'acct-1',
      provider: 'test-broker',
      paperTrading: true,
      cash: 1000.25,
      equity: 1250.75,
      buyingPower: 900,
    })

    expect(normalizeBrokerPosition({
      symbol: 'spy',
      assetType: 'etf',
      quantity: '3',
      averagePrice: '500',
      currentPrice: '510',
      unrealizedPnl: '30',
    }, 'test-broker')).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      provider: 'test-broker',
      quantityTerm: 'shares',
      marketValue: 1530,
      unrealizedPnl: 30,
    })
  })

  it('normalizes paper order requests and simulated responses', () => {
    const order = normalizeOrderRequest({
      id: 'order-1',
      symbol: 'spy',
      assetType: 'etf',
      side: 'BUY',
      type: 'limit',
      quantity: '4',
      limitPrice: '526',
      stopPrice: '513',
      paperTrading: true,
    }, 'test-broker')

    expect(order).toMatchObject({
      orderId: 'order-1',
      symbol: 'SPY',
      assetType: 'etf',
      side: 'buy',
      orderType: 'limit',
      quantity: 4,
      quantityTerm: 'shares',
      price: 526,
      stopPrice: 513,
      paperTrading: true,
    })

    const response = normalizeSimulatedOrderResponse({
      finalStatus: 'filled',
      reason: 'filled',
      proposedTrade: order,
      fill: {
        symbol: 'SPY',
        assetType: 'etf',
        side: 'buy',
        orderType: 'limit',
        quantity: 4,
        fillPrice: 526.1,
        referencePrice: 526,
        slippageBps: 2,
        slippageAmount: 0.4,
        fees: 1.05,
        notional: 2104.4,
        cashImpact: -2105.45,
      },
      timestamp: '2026-07-03T15:00:00.000Z',
    }, 'test-broker')

    expect(response).toMatchObject({
      ok: true,
      provider: 'test-broker',
      paperTrading: true,
      status: 'filled',
      fill: {
        symbol: 'SPY',
        quantityTerm: 'shares',
        fillPrice: 526.1,
      },
    })
  })

  it('emits broker adapter health events', async () => {
    const eventBus = createEventBus()
    const events = []
    const adapter = createMockPaperBrokerAdapter({ eventBus })

    eventBus.subscribe(BROKER_ADAPTER_CHECKED_EVENT, (payload) => events.push(payload))

    const result = await adapter.checkHealth({ now: '2026-07-03T15:00:00.000Z' })

    expect(events).toHaveLength(1)
    expect(events[0]).toBe(result)
    expect(events[0]).toMatchObject({
      provider: 'mock-paper-broker-adapter',
      paperTrading: true,
      liveOrders: false,
      status: 'healthy',
    })
  })

  it('rejects non-paper orders safely', async () => {
    const adapter = createMockPaperBrokerAdapter()
    const result = await adapter.submitPaperOrder({
      symbol: 'SPY',
      assetType: 'etf',
      side: 'buy',
      orderType: 'market',
      quantity: 1,
      price: 526,
      stopPrice: 513,
      paperTrading: false,
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe('error')
    expect(result.error).toMatchObject({
      code: 'broker_adapter_error',
      message: 'mock broker adapter only accepts paper orders',
    })
  })

  it('delegates approved paper submissions to the execution simulator', async () => {
    const adapter = createMockPaperBrokerAdapter()
    const order = {
      id: 'paper-order-1',
      symbol: 'SPY',
      assetType: 'etf',
      side: 'buy',
      orderType: 'limit',
      quantity: 2,
      price: 526,
      stopPrice: 513,
      paperTrading: true,
    }
    const result = await adapter.submitPaperOrder(order, {
      guardrailDecision: {
        approved: true,
        decision: 'approved',
        portfolioId: 'paper-portfolio',
        proposedTrade: order,
      },
      quote: {
        bid: 525.78,
        ask: 525.92,
        last: 525.86,
        low: 525.4,
        high: 526.3,
        liquidityScore: 94,
      },
    })

    expect(result.ok).toBe(true)
    expect(result.data.status).toBe('filled')
    expect(result.data.fill).toMatchObject({
      symbol: 'SPY',
      assetType: 'etf',
      quantity: 2,
      quantityTerm: 'shares',
    })
    expect(result.health.paperTrading).toBe(true)
    expect(result.health.liveOrders).toBe(false)
  })
})
