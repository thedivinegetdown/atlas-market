import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { orderRepository } from './tradingRuntime.js'
import { useEventBus } from './useEventBus.js'

export function useOrders() {
  const [orders, setOrders] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [lastError, setLastError] = useState(null)

  const refreshOrders = useCallback(async () => {
    setIsRefreshing(true)
    setLastError(null)

    try {
      const response = await workspaceApiClient.getOrders()
      setOrders(response.orders ?? [])
      return response.orders ?? []
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to load orders'
      setLastError(message)
      const fallbackOrders = orderRepository.list()
      setOrders(fallbackOrders)
      return fallbackOrders
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refreshOrders()
  }, [refreshOrders])

  // Auto-refresh when order events fire
  useEventBus(['order:created', 'order:updated', 'order:cancelled'], 
    () => void refreshOrders(), 
    [refreshOrders])

  const submitOrder = useCallback(async (payload, quote = {}, portfolio = {}) => {
    setLastError(null)

    try {
      const response = await workspaceApiClient.submitPaperOrder({
        ...payload,
        quote,
        portfolioId: portfolio?.id,
      })
      await refreshOrders()
      return { order: response.order, error: null }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to submit paper order'
      setLastError(message)
      return { order: null, error: { message } }
    }
  }, [refreshOrders])

  const cancelOrder = useCallback(async (orderId) => {
    setLastError(null)

    try {
      const response = await workspaceApiClient.cancelPaperOrder(orderId)
      await refreshOrders()
      return response.order
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to cancel paper order'
      setLastError(message)
      return null
    }
  }, [refreshOrders])

  return useMemo(() => ({
    orders,
    submitOrder,
    cancelOrder,
    refresh: refreshOrders,
    isLoading,
    isRefreshing,
    error: lastError,
  }), [cancelOrder, isLoading, isRefreshing, lastError, orders, refreshOrders, submitOrder])
}
