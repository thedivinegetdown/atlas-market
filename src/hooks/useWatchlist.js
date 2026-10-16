import { useCallback, useEffect, useMemo, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'
import { createPollingSubscription } from '../../lib/market/pollingSubscription.js'

const defaultSymbols = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'TSLA', 'AMZN', 'META']
const emptyQuotes = []

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to load market data'
}

function getMockOnlyMessage(response, quotes) {
  if (!quotes.length || !quotes.every((quote) => quote?.provenance?.dataStatus === 'MOCK')) return null
  const issue = response?.marketDataIssue
  const base = 'Live Watchlist quotes were not acquired. Mock-only fallback is shown and is not current market evidence.'
  if (!issue) return `${base} Provider failure details are unavailable.`
  if (issue.code === 'provider_rate_limited') {
    return issue.quotaScope === 'daily'
      ? `${base} Twelve Data reported a daily quota limit.`
      : `${base} Twelve Data reported provider rate limiting.`
  }
  if (issue.classification === 'AUTHENTICATION') return `${base} Twelve Data authentication was unavailable.`
  if (issue.classification === 'TIMEOUT') return `${base} The Twelve Data request timed out.`
  if (issue.classification === 'NETWORK') return `${base} The Twelve Data request failed in transport.`
  if (issue.classification === 'PROVIDER_ERROR') return `${base} Twelve Data returned an unusable provider response.`
  return `${base} Provider failure classification: unavailable.`
}

export function useWatchlist({
  initialQuotes = emptyQuotes,
  initialSymbol = defaultSymbols[0],
  pollingIntervalMs = null,
  autoLoad = true,
  onSnapshot,
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
      const nextSelectedSymbol = nextQuotes.some((quote) => quote.symbol === selectedSymbol)
        ? selectedSymbol
        : nextQuotes[0]?.symbol ?? selectedSymbol
      setQuotes(nextQuotes)
      setError(getMockOnlyMessage(response, nextQuotes))
      if (nextSelectedSymbol !== selectedSymbol) setSelectedSymbol(nextSelectedSymbol)
      onSnapshot?.({ quotes: nextQuotes, selectedSymbol: nextSelectedSymbol })

      return nextQuotes
    } catch (fetchError) {
      setError(getErrorMessage(fetchError))
      return []
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [onSnapshot, selectedSymbol])

  useEffect(() => {
    if (initialQuotes.length > 0 || !autoLoad) return

    if (pollingIntervalMs) {
      const subscription = createPollingSubscription({
        intervalMs: pollingIntervalMs,
        fetcher: fetchQuotes,
        onError: (subscriptionError) => setError(getErrorMessage(subscriptionError)),
      })
      subscription.start()
      return () => subscription.stop()
    }

    let active = true
    void Promise.resolve().then(() => active && fetchQuotes())
    return () => { active = false }
  }, [autoLoad, fetchQuotes, initialQuotes, pollingIntervalMs])

  const selectedQuote = useMemo(() => {
    return quotes.find((quote) => quote.symbol === selectedSymbol) ?? quotes[0] ?? null
  }, [quotes, selectedSymbol])

  const selectSymbol = useCallback((symbol) => {
    if (symbol) {
      setSelectedSymbol(symbol)
      onSnapshot?.({ quotes, selectedSymbol: symbol })
    }
  }, [onSnapshot, quotes])

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
