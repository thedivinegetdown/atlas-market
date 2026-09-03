import { useCallback, useEffect, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { createPollingSubscription } from '../../lib/market/pollingSubscription.js'

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to load selected symbol'
}

export function useMarketOverview({ symbol, initialQuote = null, pollingIntervalMs = null, enabled = true } = {}) {
  const [quote, setQuote] = useState(initialQuote)
  const [regime, setRegime] = useState(null)
  const [isLoading, setIsLoading] = useState(enabled && Boolean(symbol) && !initialQuote)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!symbol) {
      setQuote(null)
      setRegime(null)
      setIsLoading(false)
      setError(null)
      return
    }

    if (initialQuote?.symbol === symbol) {
      setQuote(initialQuote)
      setIsLoading(false)
      setError(null)
    }
  }, [initialQuote, symbol])

  const refresh = useCallback(async () => {
    if (!symbol) {
      setQuote(null)
      setError(null)
      setIsLoading(false)
      return null
    }

    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getMarketOverview(symbol)
      const nextQuote = response.quote
      setQuote(nextQuote)
      setRegime(response.regime ?? null)
      return nextQuote
    } catch (fetchError) {
      setError(getErrorMessage(fetchError))
      return null
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [symbol])

  useEffect(() => {
    if (enabled && symbol && pollingIntervalMs) {
      const subscription = createPollingSubscription({
        intervalMs: pollingIntervalMs,
        fetcher: refresh,
        onError: (subscriptionError) => setError(getErrorMessage(subscriptionError)),
      })
      subscription.start()
      return () => subscription.stop()
    }

    if (enabled && symbol && !initialQuote) {
      void refresh()
    }
  }, [enabled, initialQuote, pollingIntervalMs, refresh, symbol])

  return {
    quote,
    regime,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }
}
