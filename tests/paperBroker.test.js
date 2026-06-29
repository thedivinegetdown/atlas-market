import { describe, expect, it, beforeEach } from 'vitest'
import { createPaperBroker } from '../lib/broker/paperBroker.js'
import { resetStore } from '../lib/repositories/store.js'
import { createPortfolioRepository } from '../lib/repositories/portfolioRepository.js'
import { createJournalRepository } from '../lib/repositories/journalRepository.js'
import { createOrderRepository } from '../lib/repositories/orderRepository.js'
import { createRiskEngine } from '../lib/risk/riskEngine.js'

beforeEach(() => {
  resetStore()
})

describe('paper broker', () => {
  it('fills a valid market buy order', () => {
    const portfolioRepository = createPortfolioRepository()
    portfolioRepository.create({ id: 'portfolio-1', cash: 10000, exposure: 0.1 })

    const broker = createPaperBroker({
      orderRepository: createOrderRepository(),
      portfolioRepository,
      journalRepository: createJournalRepository(),
      riskEngine: createRiskEngine(),
    })

    const result = broker.submitOrder({ symbol: 'AAPL', type: 'MARKET', side: 'BUY', quantity: 5, price: 100 }, { price: 100 })

    expect(result.order.state).toBe('FILLED')
    expect(result.order.quantity).toBe(5)
  })

  it('rejects an invalid order', () => {
    const broker = createPaperBroker()
    const result = broker.submitOrder({ symbol: '', type: 'MARKET', side: 'BUY', quantity: 0, price: 0 }, { price: 100 })

    expect(result.error).not.toBeNull()
  })

  it('blocks orders when the kill switch is active', () => {
    const broker = createPaperBroker({ riskEngine: createRiskEngine({ killSwitch: true }) })
    const result = broker.submitOrder({ symbol: 'AAPL', type: 'MARKET', side: 'BUY', quantity: 2, price: 20 }, { price: 20 })

    expect(result.error).not.toBeNull()
    expect(result.order).toBeNull()
  })

  it('cancels a working order', () => {
    const broker = createPaperBroker()
    const created = broker.submitOrder({ symbol: 'AAPL', type: 'LIMIT', side: 'BUY', quantity: 3, price: 100 }, { price: 100 })
    const canceled = broker.cancelOrder(created.order.id)

    expect(canceled.state).toBe('CANCELED')
  })

  it('cannot cancel a filled order', () => {
    const broker = createPaperBroker()
    const created = broker.submitOrder({ symbol: 'AAPL', type: 'MARKET', side: 'BUY', quantity: 3, price: 100 }, { price: 100 })
    const canceled = broker.cancelOrder(created.order.id)

    expect(canceled).toBeNull()
  })

  it('replaces a working limit order', () => {
    const broker = createPaperBroker()
    const created = broker.submitOrder({ symbol: 'AAPL', type: 'LIMIT', side: 'BUY', quantity: 3, price: 100 }, { price: 100 })
    const replaced = broker.replaceOrder(created.order.id, { symbol: 'AAPL', type: 'LIMIT', side: 'BUY', quantity: 4, price: 101 }, { price: 100 })

    expect(replaced.quantity).toBe(4)
    expect(replaced.price).toBe(101)
  })
})
