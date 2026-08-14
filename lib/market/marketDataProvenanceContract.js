import { isMarketDataStale } from './marketNormalizer.js'

export const MARKET_DATA_STATES = Object.freeze({
  LIVE: 'LIVE', DELAYED: 'DELAYED', STALE: 'STALE', DEGRADED: 'DEGRADED',
  MOCK: 'MOCK', UNAVAILABLE: 'UNAVAILABLE', UNKNOWN: 'UNKNOWN',
})

const KNOWN_STATES = new Set(Object.values(MARKET_DATA_STATES))
const MOCK_PROVIDER = /mock|demo|synthetic/i

function timestamp(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null
  return new Date(value).toISOString()
}

function warnings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item ?? '').trim().toUpperCase().replace(/[^A-Z0-9_:-]/g, '_')).filter(Boolean))]
}

export function normalizeMarketDataProvenance(input = {}, options = {}) {
  const provider = String(input.provider ?? 'unknown').trim().toLowerCase() || 'unknown'
  const observedAt = timestamp(input.observedAt ?? input.updatedAt ?? input.asOf)
  const receivedAt = timestamp(input.receivedAt)
  const explicit = String(input.dataStatus ?? input.status ?? '').toUpperCase()
  const fallbackUsed = input.fallbackUsed === true
  const mock = input.mock === true || MOCK_PROVIDER.test(provider) || explicit === 'MOCK'
  const delayed = input.delayed === true || explicit === 'DELAYED'
  const unavailable = input.available === false || explicit === 'UNAVAILABLE'
  const stale = explicit === 'STALE' || (!mock && observedAt && isMarketDataStale(observedAt, options))
  let dataStatus = 'UNKNOWN'
  if (unavailable) dataStatus = 'UNAVAILABLE'
  else if (mock) dataStatus = 'MOCK'
  else if (stale) dataStatus = 'STALE'
  else if (delayed) dataStatus = 'DELAYED'
  else if (fallbackUsed || explicit === 'DEGRADED') dataStatus = 'DEGRADED'
  else if (explicit === 'LIVE' || (provider !== 'unknown' && observedAt)) dataStatus = 'LIVE'
  else if (KNOWN_STATES.has(explicit)) dataStatus = explicit
  const warningCodes = warnings(input.warningCodes ?? input.warnings)
  if (dataStatus === 'MOCK' && !warningCodes.includes('MOCK_DATA')) warningCodes.push('MOCK_DATA')
  if (fallbackUsed && !warningCodes.includes('FALLBACK_USED')) warningCodes.push('FALLBACK_USED')
  if (dataStatus === 'UNAVAILABLE' && !warningCodes.includes('MARKET_DATA_UNAVAILABLE')) warningCodes.push('MARKET_DATA_UNAVAILABLE')
  return {
    provider, dataStatus, observedAt, receivedAt,
    freshness: dataStatus === 'STALE' ? 'STALE' : observedAt ? 'FRESH' : 'UNKNOWN',
    fallbackUsed, mock, delayed, warningCodes,
    sourceCount: Math.max(0, Number.isFinite(Number(input.sourceCount)) ? Number(input.sourceCount) : provider === 'unknown' ? 0 : 1),
  }
}

export function combineMarketDataProvenance(items = []) {
  const normalized = items.filter(Boolean).map((item) => normalizeMarketDataProvenance(item))
  if (!normalized.length) return normalizeMarketDataProvenance()
  const priority = ['UNAVAILABLE', 'MOCK', 'STALE', 'DELAYED', 'DEGRADED', 'UNKNOWN', 'LIVE']
  return normalizeMarketDataProvenance({
    provider: [...new Set(normalized.map((item) => item.provider))].join(',') || 'unknown',
    dataStatus: priority.find((status) => normalized.some((item) => item.dataStatus === status)) ?? 'UNKNOWN',
    observedAt: normalized.map((item) => item.observedAt).filter(Boolean).sort().at(-1) ?? null,
    receivedAt: normalized.map((item) => item.receivedAt).filter(Boolean).sort().at(-1) ?? null,
    fallbackUsed: normalized.some((item) => item.fallbackUsed), mock: normalized.some((item) => item.mock),
    delayed: normalized.some((item) => item.delayed), warningCodes: normalized.flatMap((item) => item.warningCodes),
    sourceCount: normalized.reduce((sum, item) => sum + item.sourceCount, 0),
  })
}
