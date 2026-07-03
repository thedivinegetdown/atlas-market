import { useCallback, useEffect, useMemo, useState } from 'react'
import { createSignalEngine } from '../../lib/signals/signalEngine.js'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

const signalEngine = createSignalEngine()

function getErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to calculate signal'
}

function calculateSignal(quote) {
  if (!quote?.symbol) {
    return null
  }

  return signalEngine.evaluateQuote(quote)
}

export function useSignals(quote, { symbol } = {}) {
  const activeSymbol = symbol ?? quote?.symbol ?? ''
  const [signal, setSignal] = useState(() => calculateSignal(quote))
  const [isLoading, setIsLoading] = useState(Boolean(activeSymbol) && !quote)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!activeSymbol) {
      setSignal(null)
      setIsLoading(false)
      setError(null)
      return
    }

    if (quote?.symbol === activeSymbol) {
      setSignal(calculateSignal(quote))
      setIsLoading(false)
      setError(null)
    }
  }, [activeSymbol, quote])

  const refresh = useCallback(async () => {
    if (!activeSymbol) {
      setSignal(null)
      setIsLoading(false)
      setError(null)
      return null
    }

    setIsRefreshing(true)
    setError(null)

    try {
      const response = await workspaceApiClient.getSignal(activeSymbol)
      const nextSignal = response.signal
      setSignal(nextSignal)
      return nextSignal
    } catch (refreshError) {
      setError(getErrorMessage(refreshError))
      return null
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }, [activeSymbol, quote])

  useEffect(() => {
    if (activeSymbol && !quote) {
      void refresh()
    }
  }, [activeSymbol, quote, refresh])

  return useMemo(() => ({
    signal,
    activeSymbol,
    isLoading,
    isRefreshing,
    error,
    refresh,
  }), [activeSymbol, error, isLoading, isRefreshing, refresh, signal])
}
