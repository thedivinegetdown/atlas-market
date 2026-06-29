import { createJournalRepository } from '../repositories/journalRepository.js'
import { createOrderRepository } from '../repositories/orderRepository.js'
import { createPortfolioRepository } from '../repositories/portfolioRepository.js'
import { createRiskEngine } from '../risk/riskEngine.js'
import { getOrderStates } from '../orders/orderStateEngine.js'

export function createExecutionSimulator({
  orderRepository = createOrderRepository(),
  portfolioRepository = createPortfolioRepository(),
  journalRepository = createJournalRepository(),
  riskEngine = createRiskEngine(),
} = {}) {
  return {
    simulateFill(order, quote = {}) {
      const fillPrice = Number(quote?.price ?? order?.price ?? 0)
      const filledOrder = {
        ...order,
        state: getOrderStates().FILLED,
        filledPrice: fillPrice,
      }

      orderRepository.update(order.id, () => filledOrder)
      const portfolio = portfolioRepository.list()[0] ?? { id: 'portfolio-1', cash: 10000, exposure: 0.1 }
      portfolioRepository.update(portfolio.id, () => ({
        ...portfolio,
        cash: Number(portfolio.cash ?? 10000) - (Number(filledOrder.quantity) * fillPrice),
        exposure: Number(portfolio.exposure ?? 0.1) + 0.05,
      }))

      journalRepository.create({
        orderId: filledOrder.id,
        message: `${filledOrder.side} ${filledOrder.symbol} filled at ${fillPrice}`,
      })

      return filledOrder
    },
  }
}
