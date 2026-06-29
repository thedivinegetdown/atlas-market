import { createOrderEngine } from '../orders/orderEngine.js'
import { createPortfolioRepository } from '../repositories/portfolioRepository.js'
import { createOrderRepository } from '../repositories/orderRepository.js'
import { createJournalRepository } from '../repositories/journalRepository.js'
import { createRiskEngine } from '../risk/riskEngine.js'
import { createExecutionSimulator } from './executionSimulator.js'

export function createPaperBroker({
  orderRepository = createOrderRepository(),
  portfolioRepository = createPortfolioRepository(),
  journalRepository = createJournalRepository(),
  riskEngine = createRiskEngine(),
} = {}) {
  const orderEngine = createOrderEngine({
    orderRepository,
    portfolioRepository,
    journalRepository,
    riskEngine,
  })
  const executionSimulator = createExecutionSimulator()

  return {
    submitOrder(payload, quote = {}, portfolio = {}) {
      const result = orderEngine.createOrder(payload, quote, portfolio)
      if (result.error) {
        return result
      }

      if (payload?.type === 'MARKET' || payload?.type === 'STOP') {
        const executed = executionSimulator.simulateFill(result.order, quote)
        return {
          ...result,
          order: executed,
        }
      }

      return result
    },

    cancelOrder(orderId) {
      return orderEngine.cancelOrder(orderId)
    },

    replaceOrder(orderId, nextPayload, quote = {}, portfolio = {}) {
      return orderEngine.replaceOrder(orderId, nextPayload, quote, portfolio)
    },
  }
}
