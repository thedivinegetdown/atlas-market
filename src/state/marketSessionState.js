import { createContext, useContext } from 'react'

const REUSABLE_DATA_STATUSES = new Set(['LIVE', 'STALE', 'MOCK'])
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,19}$/

export const MarketSessionContext = createContext(null)

function normalizedSymbol(value) {
  return String(value ?? '').trim().toUpperCase()
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(value))
}

export function createMarketSessionIdentityKey(user, organizationId = 'org-atlas-local') {
  const userId = String(user?.id ?? '').trim()
  const scope = String(organizationId ?? '').trim()
  return userId && scope ? `${scope}:${userId}` : null
}

export function isReusableQuoteEvidence(quote, symbol = quote?.symbol) {
  const expectedSymbol = normalizedSymbol(symbol)
  const quoteSymbol = normalizedSymbol(quote?.symbol)
  const provenance = quote?.provenance
  return Boolean(
    SYMBOL_PATTERN.test(expectedSymbol)
    && quoteSymbol === expectedSymbol
    && Number.isFinite(Number(quote?.price))
    && provenance
    && typeof provenance.provider === 'string'
    && provenance.provider.trim()
    && REUSABLE_DATA_STATUSES.has(provenance.dataStatus)
    && validTimestamp(provenance.observedAt ?? quote?.updatedAt),
  )
}

export function isReusableWatchlistSnapshot(snapshot) {
  return Boolean(
    snapshot
    && Array.isArray(snapshot.quotes)
    && snapshot.quotes.length > 0
    && snapshot.quotes.every((quote) => isReusableQuoteEvidence(quote)),
  )
}

export function normalizeMarketSessionSymbol(value) {
  return normalizedSymbol(value)
}

export function useMarketSession() {
  return useContext(MarketSessionContext)
}
