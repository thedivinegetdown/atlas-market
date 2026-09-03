import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { createPollingSubscription } from '../../lib/market/pollingSubscription.js'

const defaultSymbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META']
const emptyQuotes = []

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to load market data'
}

export function useWatchlist({
  initialQuotes = emptyQuotes,
  initialSymbol = defaultSymbols[0],
  pollingIntervalMs = null,
  autoLoad = true,
} = {}) {
  const [quotes, setQuotes] = useState(initialQuotes)
  const [selectedSymbol, setSelectedSymbol] = useState(initialSymbol)
  const [isLoading, setIsLoading] = useState(autoLoad && initialQuotes.length === 0)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchQuotes = useCallback(async () => {
    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getWatchlist()
      const nextQuotes = response.quotes ?? []
      setQuotes(nextQuotes)

      if (!selectedSymbol && nextQuotes[0]?.symbol) {
        setSelectedSymbol(nextQuotes[0].symbol)
      }

      return nextQuotes
    } catch (fetchError) {
      setError(getErrorMessage(fetchError))
      return []
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [selectedSymbol])

  useEffect(() => {
    if (initialQuotes.length > 0) {
      setQuotes(initialQuotes)
      setIsLoading(false)
      return
    }

    if (!autoLoad) return

    if (pollingIntervalMs) {
      const subscription = createPollingSubscription({
        intervalMs: pollingIntervalMs,
        fetcher: fetchQuotes,
        onError: (subscriptionError) => setError(getErrorMessage(subscriptionError)),
      })
      subscription.start()
      return () => subscription.stop()
    }

    void fetchQuotes()
  }, [autoLoad, fetchQuotes, initialQuotes, pollingIntervalMs])

  const selectedQuote = useMemo(() => {
    return quotes.find((quote) => quote.symbol === selectedSymbol) ?? quotes[0] ?? null
  }, [quotes, selectedSymbol])

  const selectSymbol = useCallback((symbol) => {
    if (symbol) {
      setSelectedSymbol(symbol)
    }
  }, [])

  return {
    quotes,
    selectedSymbol,
    setSelectedSymbol: selectSymbol,
    selectedQuote,
    isLoading,
    isRefreshing,
    error,
    refresh: fetchQuotes,
  }
}
