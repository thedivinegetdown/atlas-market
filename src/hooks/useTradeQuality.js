import { useCallback, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

export function useTradeQuality(candidate) {
  const [result, setResult] = useState({ candidateKey: null, quality: null, strategyAttribution: [] })
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)
  const evaluate = useCallback(async () => {
    if (!candidate?.symbol) return null
    setIsLoading(true)
    setError(null)
    try {
      const response = await workspaceApiClient.getTradeQuality(candidate)
      const quality = response.quality ?? null
      const strategyAttribution = response.strategyAttribution ?? []
      const primaryEligible = quality?.score != null && quality?.opportunityId && quality?.strategyId && quality.strategyId !== 'strategy-unknown'
      if (primaryEligible) {
        await workspaceApiClient.saveReviewedOpportunity({
          ...quality,
          reviewState: 'reviewed',
          orderContext: candidate.orderContext ?? quality.orderContext ?? null,
        })
      }
      setResult({ candidateKey: `${candidate.symbol}:${candidate.evaluatedAt ?? ''}`, quality, strategyAttribution })
      return { quality, strategyAttribution }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Unable to evaluate trade quality')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [candidate])
  const candidateKey = candidate?.symbol ? `${candidate.symbol}:${candidate.evaluatedAt ?? ''}` : null
  const quality = useMemo(() => result.candidateKey === candidateKey ? result.quality : null, [result, candidateKey])
  const strategyAttribution = useMemo(() => result.candidateKey === candidateKey ? result.strategyAttribution : [], [result, candidateKey])
  return useMemo(() => ({ quality, strategyAttribution, isLoading, error, evaluate }), [error, evaluate, isLoading, quality, strategyAttribution])
}
