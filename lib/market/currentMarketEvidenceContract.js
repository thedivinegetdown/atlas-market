import { createHash } from 'node:crypto'

export const CURRENT_MARKET_EVIDENCE_VERSION = 'current-market-evidence-v1'
export const CURRENT_MARKET_PROVENANCE_MAX_AGE_MS = 5 * 60 * 1000

const MOCK_IDENTITY = /mock|demo|synthetic/i
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

function text(value) {
  const result = String(value ?? '').trim()
  return result || null
}

function finiteOrNull(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) ? Number(value) : null
}

function executableOrNull(value) {
  return (typeof value === 'number' || (typeof value === 'string' && value.trim())) && Number.isFinite(Number(value)) ? Number(value) : null
}

function timestampMs(value) {
  if (typeof value !== 'string' || !ISO_TIMESTAMP.test(value)) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

function unique(values) {
  return [...new Set(values)]
}

export function compactCurrentMarketEvidence({ quote = {}, provenance = quote.provenance } = {}) {
  const source = provenance && typeof provenance === 'object' ? provenance : {}
  const sourceObservedAt = text(Object.hasOwn(source, 'sourceObservedAt') ? source.sourceObservedAt : source.observedAt)
  const derivedTimestampStatus = sourceObservedAt === null ? 'MISSING' : timestampMs(sourceObservedAt) === null ? 'MALFORMED' : 'VALID'
  const sourceTimestampStatus = ['VALID', 'MISSING', 'MALFORMED'].includes(source.sourceTimestampStatus)
    ? source.sourceTimestampStatus === derivedTimestampStatus ? derivedTimestampStatus : 'MALFORMED'
    : derivedTimestampStatus
  return {
    version: CURRENT_MARKET_EVIDENCE_VERSION,
    symbol: text(quote.symbol),
    price: finiteOrNull(quote.price ?? quote.last),
    bid: executableOrNull(quote.bid),
    ask: executableOrNull(quote.ask),
    bidSize: executableOrNull(Object.hasOwn(quote, 'bidSize') ? quote.bidSize : quote.bid_size),
    askSize: executableOrNull(Object.hasOwn(quote, 'askSize') ? quote.askSize : quote.ask_size),
    provider: text(source.provider),
    source: text(source.source),
    dataStatus: text(source.dataStatus),
    freshness: text(source.freshness),
    fallbackUsed: typeof source.fallbackUsed === 'boolean' ? source.fallbackUsed : null,
    mock: typeof source.mock === 'boolean' ? source.mock : null,
    delayed: typeof source.delayed === 'boolean' ? source.delayed : null,
    sourceObservedAt,
    sourceTimestampStatus,
    observedAt: text(source.observedAt ?? sourceObservedAt),
    receivedAt: text(source.receivedAt),
    sourceCount: finiteOrNull(source.sourceCount),
    warningCodes: Array.isArray(source.warningCodes) ? unique(source.warningCodes.map((value) => text(value)).filter(Boolean)) : [],
  }
}

export function currentMarketEvidenceFingerprint(evidence = {}) {
  return createHash('sha256').update(JSON.stringify([
    evidence.version ?? null,
    evidence.symbol ?? null,
    evidence.price ?? null,
    evidence.bid ?? null,
    evidence.ask ?? null,
    evidence.bidSize ?? null,
    evidence.askSize ?? null,
    evidence.provider ?? null,
    evidence.source ?? null,
    evidence.dataStatus ?? null,
    evidence.freshness ?? null,
    evidence.fallbackUsed ?? null,
    evidence.mock ?? null,
    evidence.delayed ?? null,
    evidence.sourceObservedAt ?? null,
    evidence.sourceTimestampStatus ?? null,
    evidence.observedAt ?? null,
    evidence.receivedAt ?? null,
    evidence.sourceCount ?? null,
    evidence.warningCodes ?? [],
  ])).digest('hex')
}

export function validateCurrentMarketEvidence(evidence = {}, { now, maxAgeMs = CURRENT_MARKET_PROVENANCE_MAX_AGE_MS, requirePrice = true } = {}) {
  const reasons = []
  const nowMs = timestampMs(now)
  const observedMs = timestampMs(evidence.sourceObservedAt)
  const receivedMs = timestampMs(evidence.receivedAt)
  const identity = text(evidence.provider) ?? text(evidence.source)

  if (evidence.version !== CURRENT_MARKET_EVIDENCE_VERSION) reasons.push('current_market_evidence_version_missing')
  if (!text(evidence.symbol)) reasons.push('current_market_symbol_missing')
  if (requirePrice && !(Number.isFinite(Number(evidence.price)) && Number(evidence.price) > 0)) reasons.push('current_market_price_invalid')
  if (!identity || /^(unknown|unavailable|null|none)$/i.test(identity)) reasons.push('current_market_provider_or_source_missing')
  if (identity && MOCK_IDENTITY.test(identity)) reasons.push('current_market_mock_identity')
  if (evidence.dataStatus !== 'LIVE') reasons.push('current_market_status_not_live')
  if (evidence.fallbackUsed !== false) reasons.push('current_market_fallback_not_explicitly_false')
  if (evidence.mock !== false) reasons.push('current_market_mock_not_explicitly_false')
  if (evidence.delayed === true) reasons.push('current_market_delayed')
  if (evidence.freshness && evidence.freshness !== 'FRESH') reasons.push('current_market_freshness_not_fresh')
  if (evidence.sourceTimestampStatus === 'MALFORMED') reasons.push('current_market_source_observed_at_malformed')
  else if (observedMs === null) reasons.push(evidence.sourceObservedAt == null
    ? 'current_market_source_observed_at_missing'
    : 'current_market_source_observed_at_malformed')
  if (evidence.sourceTimestampStatus !== 'VALID') reasons.push('current_market_source_timestamp_status_invalid')
  if (timestampMs(evidence.observedAt) !== observedMs) reasons.push('current_market_observation_alias_mismatch')
  if (receivedMs === null) reasons.push('current_market_received_at_malformed')
  if (nowMs === null) reasons.push('current_market_operation_timestamp_malformed')
  if (observedMs !== null && receivedMs !== null && receivedMs < observedMs) reasons.push('current_market_receipt_precedes_observation')
  if (observedMs !== null && nowMs !== null && observedMs > nowMs) reasons.push('current_market_observation_in_future')
  if (receivedMs !== null && nowMs !== null && receivedMs > nowMs) reasons.push('current_market_receipt_in_future')
  if (observedMs !== null && nowMs !== null && Number.isFinite(Number(maxAgeMs)) && nowMs - observedMs > Number(maxAgeMs)) reasons.push('current_market_evidence_stale')

  const codes = unique(reasons)
  return {
    valid: codes.length === 0,
    reasons: codes,
    observedAgeMs: observedMs !== null && nowMs !== null ? nowMs - observedMs : null,
  }
}

export function validateCurrentMarketEvidenceBundle(bundle = {}, options = {}) {
  const candidate = validateCurrentMarketEvidence(bundle.candidate, options)
  const regime = validateCurrentMarketEvidence(bundle.regime, options)
  const reasons = unique([
    ...candidate.reasons.map((reason) => `candidate:${reason}`),
    ...regime.reasons.map((reason) => `regime:${reason}`),
  ])
  const fingerprint = currentMarketEvidenceFingerprint({
    version: bundle.version,
    symbol: `${currentMarketEvidenceFingerprint(bundle.candidate)}:${currentMarketEvidenceFingerprint(bundle.regime)}`,
  })
  if (bundle.version !== CURRENT_MARKET_EVIDENCE_VERSION) reasons.push('bundle:current_market_evidence_version_missing')
  if (bundle.fingerprint !== fingerprint) reasons.push('bundle:current_market_evidence_fingerprint_mismatch')
  return { valid: reasons.length === 0, reasons: unique(reasons), fingerprint, candidate, regime }
}

export function createCurrentMarketEvidenceBundle({ candidate, regime } = {}) {
  const bundle = { version: CURRENT_MARKET_EVIDENCE_VERSION, candidate, regime }
  return { ...bundle, fingerprint: validateCurrentMarketEvidenceBundle({ ...bundle, fingerprint: null }).fingerprint }
}
