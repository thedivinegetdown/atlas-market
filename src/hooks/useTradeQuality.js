import { useCallback, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function useTradeQuality(candidate) {
  const [result, setResult] = useState({ candidateKey: null, quality: null })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const evaluate = useCallback(async () => {
    if (!candidate?.symbol) return null
    setIsLoading(true)
    setError(null)
    try {
      const response = await workspaceApiClient.getTradeQuality(candidate)
      setResult({ candidateKey: `${candidate.symbol}:${candidate.evaluatedAt ?? ''}`, quality: response.quality ?? null })
      return response.quality ?? null
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to evaluate trade quality')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [candidate])
  const candidateKey = candidate?.symbol ? `${candidate.symbol}:${candidate.evaluatedAt ?? ''}` : null
  const quality = result.candidateKey === candidateKey ? result.quality : null
  return useMemo(() => ({ quality, isLoading, error, evaluate }), [error, evaluate, isLoading, quality])
}
