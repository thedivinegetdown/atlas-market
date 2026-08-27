import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function useDecisionIntelligence() {
  const [intelligence, setIntelligence] = useState(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState(null)
  const refresh = useCallback(async (planId) => {
    setIsLoading(true); setError(null)
    try { const value = await workspaceApiClient.getDecisionIntelligence(planId); setIntelligence(value); return value } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to load decision intelligence'); return null } finally { setIsLoading(false) }
  }, [])
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => clearTimeout(timer) }, [refresh])
  return { intelligence, isLoading, error, refresh }
}