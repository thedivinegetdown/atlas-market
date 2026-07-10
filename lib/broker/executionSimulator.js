import { createJournalRepository } from '../repositories/journalRepository.js'
import { createOrderRepository } from '../repositories/orderRepository.js'
import { createPortfolioRepository } from '../repositories/portfolioRepository.js'
import { getOrderStates } from '../orders/orderStateEngine.js'
import { tradingEventLogger, TRADING_EVENTS } from '../observability/eventLogger.js'

export function createExecutionSimulator({
  orderRepository = createOrderRepository(),
  portfolioRepository = createPortfolioRepository(),
  journalRepository = createJournalRepository(),
  eventLogger = tradingEventLogger,
} = {}) {
  return {
    simulateFill(order, quote = {}, { requestId } = {}) {
      const fillPrice = Number(quote?.price ?? order?.price ?? 0)
      const signedCashChange = order?.side === 'SELL'
        ? Number(order?.quantity ?? 0) * fillPrice
        : -(Number(order?.quantity ?? 0) * fillPrice)
      const filledOrder = {
        ...order,
        state: getOrderStates().FILLED,
        filledPrice: fillPrice,
      }

      orderRepository.update(order.id, () => filledOrder)
      const portfolio = portfolioRepository.list()[0] ?? portfolioRepository.create({ id: 'portfolio-1', cash: 100000, exposure: 0.1 })
      portfolioRepository.update(portfolio.id, () => ({
        ...portfolio,
        cash: Number(portfolio.cash ?? 100000) + signedCashChange,
        exposure: Number(portfolio.exposure ?? 0.1) + 0.05,
      }))
      eventLogger.log(TRADING_EVENTS.POSITION_UPDATED, {
        requestId,
        symbol: filledOrder.symbol,
        side: filledOrder.side,
        quantity: filledOrder.quantity,
      })

      journalRepository.create({
        orderId: filledOrder.id,
        symbol: filledOrder.symbol,
        side: filledOrder.side,
        quantity: filledOrder.quantity,
        fillPrice,
        message: `${filledOrder.side} ${filledOrder.symbol} filled at ${fillPrice}`,
      })
      eventLogger.log(TRADING_EVENTS.JOURNAL_ENTRY_CREATED, {
        requestId,
        orderId: filledOrder.id,
        symbol: filledOrder.symbol,
      })

      return filledOrder
    },
  }
}
