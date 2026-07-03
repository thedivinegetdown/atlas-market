import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient, workspaceApiDiagnostics } from '../api/workspaceApiClient.js'

const defaultHealth = {
  status: 'unknown',
  checks: {
    paperTrading: {
      enabled: true,
      status: 'healthy',
    },
  },
  timestamp: null,
  requestId: null,
}

export function useSystemHealth() {
  const [health, setHealth] = useState(defaultHealth)
  const [diagnostics, setDiagnostics] = useState(workspaceApiDiagnostics.getSnapshot())
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getHealth()
      setHealth(response ?? defaultHealth)
      return response
    } catch (refreshError) {
      const message = refreshError instanceof Error ? refreshError.message : 'Unable to load system health'
      setError(message)
      setHealth((current) => ({
        ...current,
        status: 'degraded',
      }))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    const unsubscribe = workspaceApiDiagnostics.subscribe(setDiagnostics)
    void refresh()
    return unsubscribe
  }, [refresh])

  return {
    health,
    diagnostics,
    apiStatus: diagnostics.apiStatus === 'unknown' ? health.status : diagnostics.apiStatus,
    lastSuccessfulSync: diagnostics.lastSuccessfulSync ?? health.timestamp,
    lastError: diagnostics.lastError ?? error,
    paperTradingEnabled: health.checks?.paperTrading?.enabled ?? true,
    isLoading,
    error,
    refresh,
  }
}
