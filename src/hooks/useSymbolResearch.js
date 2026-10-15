import { useCallback, useEffect, useRef, useState } from 'react'
import { workspaceApiClient } from '../api/workspaceApiClient.js'

function message(error, fallback) {
  return error instanceof Error ? error.message : fallback
}

export function useSymbolResearch({ symbol, initialOverview = null, initialScanner = null, autoLoad = true } = {}) {
  const [overview, setOverview] = useState(initialOverview)
  const [scanner, setScanner] = useState(initialScanner)
  const [overviewError, setOverviewError] = useState(null)
  const [scannerError, setScannerError] = useState(null)
  const [loading, setLoading] = useState(autoLoad)
  const requestSequence = useRef(0)

  const refresh = useCallback(async () => {
    if (!symbol) return
    const requestId = requestSequence.current + 1
    requestSequence.current = requestId
    setLoading(true)
    setOverviewError(null)
    setScannerError(null)
    const [overviewResult, scannerResult] = await Promise.allSettled([
      workspaceApiClient.getMarketOverview(symbol),
      workspaceApiClient.getGovernedReviewPreparationStatus(),
    ])
    if (requestSequence.current !== requestId) return
    if (overviewResult.status === 'fulfilled') setOverview(overviewResult.value)
    else setOverviewError(message(overviewResult.reason, 'Symbol market evidence is unavailable'))
    if (scannerResult.status === 'fulfilled') setScanner(scannerResult.value)
    else setScannerError(message(scannerResult.reason, 'Stored Scanner evidence is unavailable'))
    setLoading(false)
  }, [symbol])

  useEffect(() => {
    if (!autoLoad) return undefined
    const request = globalThis.setTimeout(() => void refresh(), 0)
    return () => globalThis.clearTimeout(request)
  }, [autoLoad, refresh])

  return { overview, scanner, overviewError, scannerError, loading, refresh }
}
