import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { useEventBus } from './useEventBus.js'

const emptyCurve = {
  points: [],
  drawdowns: [],
  timeline: [],
  maxDrawdown: 0,
}

export function useEquityCurve() {
  const [curve, setCurve] = useState(emptyCurve)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getEquityCurve()
      setCurve({
        points: response.points ?? [],
        drawdowns: response.drawdowns ?? [],
        timeline: response.timeline ?? [],
        maxDrawdown: response.maxDrawdown ?? 0,
      })
      return response
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load equity curve')
      return null
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-refresh when order and journal events fire
  useEventBus(['order:created', 'order:updated', 'journal:created'], 
    () => void refresh(), 
    [refresh])

  return {
    ...curve,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }
}
