import { useEffect, useMemo, useState } from 'react'
import { createPaperBroker } from '../../lib/broker/paperBroker.js'
import { createOrderRepository } from '../../lib/repositories/orderRepository.js'

const orderRepository = createOrderRepository()
const broker = createPaperBroker({ orderRepository })

export function useOrders() {
  const [orders, setOrders] = useState([])

  const refreshOrders = () => {
    setOrders(orderRepository.list())
  }

  useEffect(() => {
    refreshOrders()
  }, [])

  const submitOrder = (payload, quote = {}, portfolio = {}) => {
    const result = broker.submitOrder(payload, quote, portfolio)
    refreshOrders()
    return result
  }

  const cancelOrder = (orderId) => {
    broker.cancelOrder(orderId)
    refreshOrders()
  }

  return useMemo(() => ({
    orders,
    submitOrder,
    cancelOrder,
    refresh: refreshOrders,
  }), [orders])
}
