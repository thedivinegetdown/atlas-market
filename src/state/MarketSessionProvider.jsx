import { useCallback, useMemo, useRef } from 'react'
import {
  isReusableQuoteEvidence,
  isReusableWatchlistSnapshot,
  MarketSessionContext,
  normalizeMarketSessionSymbol,
} from './marketSessionState.js'

export function MarketSessionProvider({ identityKey, children }) {
  const snapshotRef = useRef(null)

  const readWatchlist = useCallback(() => {
    const snapshot = snapshotRef.current
    if (!identityKey || snapshot?.identityKey !== identityKey || !isReusableWatchlistSnapshot(snapshot)) return null
    return snapshot
  }, [identityKey])

  const writeWatchlist = useCallback(({ quotes, selectedSymbol } = {}) => {
    const snapshot = { identityKey, quotes, selectedSymbol: normalizeMarketSessionSymbol(selectedSymbol), capturedAt: new Date().toISOString() }
    if (!identityKey || !isReusableWatchlistSnapshot(snapshot)) return false
    snapshotRef.current = snapshot
    return true
  }, [identityKey])

  const selectWatchlistSymbol = useCallback((symbol) => {
    const snapshot = readWatchlist()
    const nextSymbol = normalizeMarketSessionSymbol(symbol)
    if (!snapshot || !snapshot.quotes.some((quote) => normalizeMarketSessionSymbol(quote.symbol) === nextSymbol)) return false
    snapshotRef.current = { ...snapshot, selectedSymbol: nextSymbol }
    return true
  }, [readWatchlist])

  const readQuote = useCallback((symbol) => {
    const expectedSymbol = normalizeMarketSessionSymbol(symbol)
    const quote = readWatchlist()?.quotes.find((item) => normalizeMarketSessionSymbol(item?.symbol) === expectedSymbol)
    return isReusableQuoteEvidence(quote, expectedSymbol) ? quote : null
  }, [readWatchlist])

  const value = useMemo(() => ({
    identityKey,
    readQuote,
    readWatchlist,
    selectWatchlistSymbol,
    writeWatchlist,
  }), [identityKey, readQuote, readWatchlist, selectWatchlistSymbol, writeWatchlist])

  return <MarketSessionContext.Provider value={value}>{children}</MarketSessionContext.Provider>
}
