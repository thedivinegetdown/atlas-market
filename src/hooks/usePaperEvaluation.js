import { useCallback, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
export function usePaperEvaluation() {
  const [evaluations, setEvaluations] = useState([]); const [isLoading, setIsLoading] = useState(false); const [error, setError] = useState(null)
  const run = useCallback(async () => { setIsLoading(true); setError(null); try { const response = await workspaceApiClient.runPaperEvaluation(); setEvaluations(response.evaluations ?? []); return response } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to run paper evaluation'); return null } finally { setIsLoading(false) } }, [])
  return { evaluations, isLoading, error, run }
}
