import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to load decision intelligence'
}

export function useDecision(symbol) {
  const activeSymbol = String(symbol ?? '').trim().toUpperCase()
  const [decision, setDecision] = useState(null)
  const [assetProfile, setAssetProfile] = useState(null)
  const [isLoading, setIsLoading] = useState(Boolean(activeSymbol))
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!activeSymbol) {
      setDecision(null)
      setAssetProfile(null)
      setIsLoading(false)
      setError(null)
      return null
    }

    setIsRefreshing(true)
    setError(null)
    try {
      const response = await workspaceApiClient.getDecision(activeSymbol)
      setDecision(response.decision)
      setAssetProfile(response.assetProfile)
      return response.decision
    } catch (refreshError) {
      setError(getErrorMessage(refreshError))
      return null
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [activeSymbol])

  useEffect(() => {
    setDecision(null)
    setAssetProfile(null)
    setIsLoading(Boolean(activeSymbol))
    setError(null)
    if (activeSymbol) {
      void refresh()
    }
  }, [activeSymbol, refresh])

  return useMemo(() => ({
    activeSymbol,
    assetProfile,
    decision,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }), [activeSymbol, assetProfile, decision, error, isLoading, isRefreshing, refresh])
}
