import { createId } from '../core/id.js'
import { createOrderRepository } from '../repositories/orderRepository.js'
import { createPortfolioRepository } from '../repositories/portfolioRepository.js'
import { createJournalRepository } from '../repositories/journalRepository.js'
import { createRiskEngine } from '../risk/riskEngine.js'
import { resolveOrderAsset } from '../assets/index.js'
import { validateOrderPayload } from './orderValidator.js'
import { getOrderStates, isTerminalState, transitionOrderState } from './orderStateEngine.js'
import { eventBus } from '../core/eventBus.js'

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

      const asset = resolveOrderAsset(payload, quote)
      const order = orderRepository.create({
        id: createId('order'),
        symbol: payload.symbol,
        assetType: asset.assetType,
        type: payload.type,
        side: payload.side,
        quantity: Number(payload.quantity),
        quantityLabel: asset.quantityLabel,
        price: Number(payload.price),
        limitPrice: Number(payload.limitPrice ?? payload.price),
        stopPrice: Number(payload.stopPrice ?? 0),
        riskPct: Number(payload.riskPct ?? 0),
        timeInForce: payload.timeInForce ?? 'DAY',
        tickSize: asset.tickSize,
        pricePrecision: asset.pricePrecision,
        contractMultiplier: asset.profile.contractMultiplier,
        state: getOrderStates().NEW,
      })

      const workingOrder = transitionOrderState(order, getOrderStates().WORKING)
      const storedOrder = orderRepository.update(order.id, () => ({ ...workingOrder }))

      // Emit order:created event to notify listeners
      eventBus.emit('order:created', { order: storedOrder })

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
      const cancelledOrder = orderRepository.update(orderId, () => ({ ...updatedOrder }))

      // Emit order:cancelled event to notify listeners
      eventBus.emit('order:cancelled', { orderId: cancelledOrder.id, reason: 'user_request', order: cancelledOrder })

      return cancelledOrder
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
      const replacedOrder = orderRepository.update(orderId, () => ({
        ...updatedOrder,
        ...nextPayload,
        quantity: Number(nextPayload.quantity),
        price: Number(nextPayload.price),
      }))

      // Emit order:updated event to notify listeners
      eventBus.emit('order:updated', { orderId, changes: nextPayload, order: replacedOrder })

      return replacedOrder
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

      // Emit order:updated event for filled orders
      eventBus.emit('order:updated', { orderId: executedOrder.id, changes: { state: executedOrder.state, filledPrice: executedOrder.filledPrice }, order: executedOrder })

      return executedOrder
    },
  }
}
