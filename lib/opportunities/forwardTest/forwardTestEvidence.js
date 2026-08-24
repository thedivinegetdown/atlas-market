export const EDGE1_SYMBOL_UNIVERSE = Object.freeze(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])

export const FORWARD_TEST_READINESS = Object.freeze({
  REAL_DATA_READY: 'REAL_DATA_READY',
  DEGRADED: 'DEGRADED',
  MOCK: 'MOCK',
  INSUFFICIENT_DATA: 'INSUFFICIENT_DATA',
})

const REAL_PROVIDER_STATES = new Set(['LIVE', 'DELAYED', 'DEGRADED'])
const SUFFICIENT_QUALITY_STATES = new Set(['COMPLETE', 'PARTIAL'])

function strategyFor(strategySuitability, strategyId) {
  return strategySuitability?.strategies?.find((strategy) => strategy.strategyId === strategyId) ?? null
}

function normalizedSymbol(value) {
  return String(value ?? '').trim().toUpperCase()
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function createForwardTestEvidenceRecord({
  symbol,
  timestamp,
  regime = {},
  strategySuitability = {},
  tradeQuality = {},
  entryReferenceContext = {},
  providerProvenance,
  riskGates = {},
} = {}) {
  const resolvedSymbol = normalizedSymbol(symbol ?? tradeQuality.symbol ?? regime.symbol)
  const strategy = strategyFor(strategySuitability, tradeQuality.strategyId)
  const provenance = providerProvenance ?? tradeQuality.marketData ?? regime.marketData ?? {}
  const dataStatus = String(provenance.dataStatus ?? 'UNKNOWN').toUpperCase()
  const freshness = String(tradeQuality.freshness ?? regime.freshness ?? dataStatus).toUpperCase()
  const boundedSymbol = EDGE1_SYMBOL_UNIVERSE.includes(resolvedSymbol)
  const mock = dataStatus === 'MOCK' || provenance.mock === true
  const stale = dataStatus === 'STALE' || freshness === 'STALE'
  const realProviderEvidence = REAL_PROVIDER_STATES.has(dataStatus) && !mock
  const validRegime = regime.classification?.status === 'COMPLETE'
  const supportedStrategy = strategy?.decision === 'ENABLED'
  const numericScore = finiteNumber(tradeQuality.score)
  const sufficientTradeQuality = numericScore !== null
    && SUFFICIENT_QUALITY_STATES.has(tradeQuality.status)
    && (tradeQuality.blockingReasons?.length ?? 0) === 0
  const riskGatesPass = riskGates.evaluated === true && riskGates.passed === true
    && (riskGates.blockers?.length ?? 0) === 0
  const blockers = []

  if (!boundedSymbol) blockers.push('symbol_outside_edge1_universe')
  if (mock) blockers.push('mock_market_evidence')
  else if (!realProviderEvidence) blockers.push('real_provider_evidence_unavailable')
  if (stale) blockers.push('stale_market_evidence')
  if (!validRegime) blockers.push('invalid_or_incomplete_regime')
  if (!strategy) blockers.push('strategy_suitability_unavailable')
  else if (!supportedStrategy) blockers.push('strategy_not_enabled')
  if (!sufficientTradeQuality) blockers.push('trade_quality_evidence_insufficient')
  if (riskGates.evaluated !== true) blockers.push('risk_gates_not_evaluated')
  else if (!riskGatesPass) blockers.push('risk_gates_failed')

  const evidenceReady = boundedSymbol && realProviderEvidence && !stale
    && validRegime && supportedStrategy && sufficientTradeQuality
  let readiness = FORWARD_TEST_READINESS.INSUFFICIENT_DATA
  if (mock) readiness = FORWARD_TEST_READINESS.MOCK
  else if (evidenceReady && dataStatus === 'LIVE') readiness = FORWARD_TEST_READINESS.REAL_DATA_READY
  else if (realProviderEvidence || stale) readiness = FORWARD_TEST_READINESS.DEGRADED

  return {
    version: 'forward-test-evidence-v1',
    symbol: resolvedSymbol,
    timestamp: timestamp ?? tradeQuality.asOf ?? regime.asOf ?? null,
    marketRegime: {
      trend: regime.classification?.trendRegime ?? 'UNKNOWN',
      volatility: regime.classification?.volatilityRegime ?? 'UNKNOWN',
      risk: regime.classification?.riskRegime ?? 'UNKNOWN',
      status: regime.classification?.status ?? 'INSUFFICIENT_DATA',
      confidence: regime.classification?.confidence ?? 0,
    },
    strategyId: tradeQuality.strategyId ?? null,
    strategySuitability: strategy ? { decision: strategy.decision, confidence: strategy.confidence } : null,
    tradeQuality: {
      score: numericScore,
      band: tradeQuality.band ?? 'UNKNOWN',
      confidence: tradeQuality.confidence ?? 0,
      status: tradeQuality.status ?? 'INSUFFICIENT_DATA',
    },
    entryReferenceContext: {
      opportunityId: entryReferenceContext.opportunityId ?? tradeQuality.opportunityId ?? null,
      scannerSource: entryReferenceContext.scannerSource ?? null,
      referencePrice: finiteNumber(entryReferenceContext.referencePrice),
    },
    providerProvenance: {
      provider: provenance.provider ?? 'unknown',
      dataStatus,
      observedAt: provenance.observedAt ?? null,
      receivedAt: provenance.receivedAt ?? null,
      fallbackUsed: provenance.fallbackUsed === true,
      mock,
    },
    readiness,
    forwardTestEligible: evidenceReady && riskGatesPass,
    missingEvidence: [...new Set([...(tradeQuality.missingInputs ?? []), ...(strategy?.missingInputs ?? [])])],
    blockers: [...new Set(blockers)],
    boundaries: {
      paperOnly: true,
      automaticExecution: false,
      liveTrading: false,
      paidServiceRequired: false,
      boundedUniverse: true,
    },
  }
}
