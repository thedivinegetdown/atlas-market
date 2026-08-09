import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function useDailyBriefing({ symbol = 'SPY', timeframe = '1D', enabled = true } = {}) {
  const [briefing, setBriefing] = useState(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState(null)
  const refresh = useCallback(async () => {
    if (!enabled) return null
    setIsLoading(true)
    setError(null)
    try {
      const response = await workspaceApiClient.getDailyBriefing(symbol, timeframe)
      setBriefing(response.briefing ?? null)
      return response.briefing ?? null
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load daily briefing')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [enabled, symbol, timeframe])
  useEffect(() => {
    if (!enabled) return undefined
    const timeoutId = globalThis.setTimeout(() => { void refresh() }, 0)
    return () => globalThis.clearTimeout(timeoutId)
  }, [enabled, refresh])
  return { briefing, isLoading, error, refresh }
}
