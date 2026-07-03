import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { useEventBus } from './useEventBus.js'

const defaultSummary = {
  accountValue: 100000,
  cash: 100000,
  buyingPower: 100000,
  dailyReturn: 0,
  totalReturn: 0,
  winRate: 0,
  averageWinner: 0,
  averageLoser: 0,
  profitFactor: 0,
  sharpeRatio: 0,
  maxDrawdown: 0,
  expectancy: 0,
  largestWinner: 0,
  largestLoser: 0,
  openRisk: 0,
}

export function usePortfolioAnalytics() {
  const [summary, setSummary] = useState(defaultSummary)
  const [isLoading, setIsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getPortfolioSummary()
      setSummary(response.summary ?? defaultSummary)
      return response.summary
    } catch (refreshError) {
      setError(refreshError instanceof Error ? refreshError.message : 'Unable to load portfolio summary')
      return null
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Auto-refresh when portfolio:updated event fires
  useEventBus('portfolio:updated', () => void refresh(), [refresh])

  return {
    summary,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }
}
