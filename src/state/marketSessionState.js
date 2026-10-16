import { createContext, useContext } from 'react'

const REUSABLE_DATA_STATUSES = new Set(['LIVE', 'STALE', 'MOCK'])
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,19}$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/
const INVALID_PROVIDER = /^(unknown|unavailable|null|none)$/i
const MOCK_PROVIDER = /mock|demo|synthetic/i

export const MarketSessionContext = createContext(null)

function normalizedSymbol(value) {
  return String(value ?? '').trim().toUpperCase()
}

function validTimestamp(value) {
  return typeof value === 'string' && ISO_TIMESTAMP.test(value) && !Number.isNaN(Date.parse(value))
}

function validPrice(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim()))
    && Number.isFinite(Number(value))
    && Number(value) > 0
}

function validProvenance(provenance) {
  const provider = typeof provenance?.provider === 'string' ? provenance.provider.trim() : ''
  if (!provider || INVALID_PROVIDER.test(provider)) return false
  if (typeof provenance.mock !== 'boolean' || typeof provenance.fallbackUsed !== 'boolean') return false
  if (provenance.dataStatus === 'MOCK') return provenance.mock === true
  if (provenance.mock || MOCK_PROVIDER.test(provider)) return false
  return provenance.dataStatus !== 'LIVE' || provenance.fallbackUsed === false
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
    && validPrice(quote?.price)
    && validProvenance(provenance)
    && REUSABLE_DATA_STATUSES.has(provenance.dataStatus)
    && validTimestamp(provenance.observedAt),
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
