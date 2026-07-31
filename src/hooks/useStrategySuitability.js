import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to load strategy suitability'
}

export function useStrategySuitability({ symbol = 'SPY', timeframe = '1D' } = {}) {
  const [suitability, setSuitability] = useState(null)
  const [isLoading, setIsLoading] = useState(Boolean(symbol))
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    if (!symbol) return null
    setIsLoading(true)
    setError(null)
    try {
      const response = await workspaceApiClient.getStrategySuitability(symbol, timeframe)
      setSuitability(response.suitability ?? null)
      return response.suitability ?? null
    } catch (requestError) {
      setError(errorMessage(requestError))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [symbol, timeframe])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { suitability, isLoading, error, refresh }
}
