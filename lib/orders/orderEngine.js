import { createId } from '../core/id.js'
import { createOrderRepository } from '../repositories/orderRepository.js'
import { createPortfolioRepository } from '../repositories/portfolioRepository.js'
import { createJournalRepository } from '../repositories/journalRepository.js'
import { createRiskEngine } from '../risk/riskEngine.js'
import { validateOrderPayload } from './orderValidator.js'
import { getOrderStates, isTerminalState, transitionOrderState } from './orderStateEngine.js'

export function createOrderEngine({
  orderRepository = createOrderRepository(),
  portfolioRepository = createPortfolioRepository(),
  journalRepository = createJournalRepository(),
  riskEngine = createRiskEngine(),
} = {}) {
  return {
    createOrder(payload, quote = {}, portfolio = {}) {
      const validationError = validateOrderPayload(payload)
      if (validationError) {
        return {
          order: null,
          error: validationError,
        }
      }

      const riskDecision = riskEngine.evaluateOrder(payload, portfolio, quote)
      if (!riskDecision.approved) {
        return {
          order: null,
          error: {
            ok: false,
            code: 'risk_blocked',
            message: riskDecision.reason,
            details: riskDecision,
          },
        }
      }

      const order = orderRepository.create({
        id: createId('order'),
        symbol: payload.symbol,
        type: payload.type,
        side: payload.side,
        quantity: Number(payload.quantity),
        price: Number(payload.price),
        state: getOrderStates().NEW,
      })

      const workingOrder = transitionOrderState(order, getOrderStates().WORKING)
      const storedOrder = orderRepository.update(order.id, () => ({ ...workingOrder }))

      return {
        order: storedOrder,
        error: null,
      }
    },

    cancelOrder(orderId) {
      const currentOrder = orderRepository.find(orderId)
      if (!currentOrder) {
        return null
      }

      if (isTerminalState(currentOrder.state)) {
        return null
      }

      const updatedOrder = transitionOrderState(currentOrder, getOrderStates().CANCELED)
      return orderRepository.update(orderId, () => ({ ...updatedOrder }))
    },

    replaceOrder(orderId, nextPayload, quote = {}, portfolio = {}) {
      const currentOrder = orderRepository.find(orderId)
      if (!currentOrder || isTerminalState(currentOrder.state)) {
        return null
      }

      const validationError = validateOrderPayload(nextPayload)
      if (validationError) {
        return null
      }

      const riskDecision = riskEngine.evaluateOrder(nextPayload, portfolio, quote)
      if (!riskDecision.approved) {
        return null
      }

      const updatedOrder = transitionOrderState(currentOrder, getOrderStates().WORKING)
      return orderRepository.update(orderId, () => ({
        ...updatedOrder,
        ...nextPayload,
        quantity: Number(nextPayload.quantity),
        price: Number(nextPayload.price),
      }))
    },

    executeOrder(orderId, quote = {}, portfolio = {}) {
      const order = orderRepository.find(orderId)
      if (!order || isTerminalState(order.state)) {
        return null
      }

      const filled = transitionOrderState(order, getOrderStates().FILLED)
      const executedOrder = orderRepository.update(orderId, () => ({ ...filled, filledPrice: Number(quote?.price ?? order.price) }))

      const nextPortfolio = {
        ...portfolio,
        cash: Number(portfolio?.cash ?? 0) - (Number(executedOrder.quantity) * Number(executedOrder.price)),
        exposure: Number(portfolio?.exposure ?? 0) + 0.1,
      }

      portfolioRepository.update(portfolio?.id, () => nextPortfolio)
      journalRepository.create({
        orderId: executedOrder.id,
        message: `Executed ${executedOrder.side} ${executedOrder.symbol}`,
      })

      return executedOrder
    },
  }
}
