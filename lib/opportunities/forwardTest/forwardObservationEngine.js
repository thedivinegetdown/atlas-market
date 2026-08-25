import { EDGE1_SYMBOL_UNIVERSE } from './forwardTestEvidence.js'

export const FORWARD_OBSERVATION_VERSION = 'forward-observation-v1'
export const FORWARD_EVIDENCE_SNAPSHOT_VERSION = 'forward-evidence-snapshot-v1'
export const FORWARD_OBSERVATION_MINIMUM_SESSIONS = 20
export const FORWARD_OBSERVATION_MINIMUM_OUTCOMES = 30
export const FORWARD_OBSERVATION_STATUSES = Object.freeze([
  'NOT_STARTED',
  'COLLECTING',
  'MINIMUM_SESSIONS_PENDING',
  'MINIMUM_OUTCOMES_PENDING',
  'READY_FOR_REVIEW',
  'INVALIDATED',
])

export const FORWARD_ELIGIBILITY_RULES = Object.freeze([
  'real_provider_evidence',
  'fresh_quote',
  'sufficient_history',
  'valid_regime',
  'supported_strategy',
  'sufficient_trade_quality',
  'liquidity_and_risk_reward_pass',
  'existing_risk_gates_pass',
  'paper_only',
])

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((output, key) => {
      if (!/raw|secret|token|credential|password|apikey/i.test(key)) output[key] = stable(value[key])
      return output
    }, {})
  }
  return value
}

function fingerprint(value) {
  const source = JSON.stringify(stable(value))
  return Array.from({ length: 8 }, (_, seed) => {
    let hash = (0x811c9dc5 ^ Math.imul(seed + 1, 0x9e3779b1)) >>> 0
    for (let index = 0; index < source.length; index += 1) {
      hash ^= source.charCodeAt(index) + seed
      hash = Math.imul(hash, 0x01000193) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
}

function iso(value, label) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid`)
  return date.toISOString()
}

function text(value, label) {
  const resolved = String(value ?? '').trim()
  if (!resolved) throw new Error(`${label} is required`)
  return resolved
}

function finite(value, fallback = null) {
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}

function uniqueSorted(values = []) {
  return [...new Set(values.map((value) => String(value).trim().toUpperCase()).filter(Boolean))].sort()
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.values(value).forEach(deepFreeze)
  return Object.freeze(value)
}

function configuration(manifest = {}) {
  return {
    strategyVersions: stable(manifest.strategyVersions ?? {}),
    regimeEngineVersion: manifest.regimeEngineVersion,
    tradeQualityVersion: manifest.tradeQualityVersion,
    riskPolicyVersion: manifest.riskPolicyVersion,
    providerRequirements: stable(manifest.providerRequirements ?? {}),
    symbolUniverse: manifest.symbolUniverse,
    eligibilityRules: manifest.eligibilityRules,
    startingPaperAccount: stable(manifest.startingPaperAccount ?? {}),
    exitPolicy: stable(manifest.exitPolicy ?? {}),
    minimumSessions: manifest.minimumSessions,
    minimumOutcomes: manifest.minimumOutcomes,
  }
}

export function createForwardObservationManifest(input = {}) {
  if (input.exitPolicy?.deterministic !== true) throw new Error('deterministic exit policy is required before the observation can start')
  const startedAt = iso(input.startedAt, 'observation start timestamp')
  const symbolUniverse = uniqueSorted(input.symbolUniverse ?? EDGE1_SYMBOL_UNIVERSE)
  if (JSON.stringify(symbolUniverse) !== JSON.stringify([...EDGE1_SYMBOL_UNIVERSE].sort())) throw new Error('forward observation symbol universe must remain frozen to the approved EDGE.1 universe')
  const manifest = {
    version: FORWARD_OBSERVATION_VERSION,
    observationId: text(input.observationId, 'observation id'),
    startedAt,
    strategyVersions: stable(input.strategyVersions ?? {}),
    regimeEngineVersion: text(input.regimeEngineVersion, 'regime engine version'),
    tradeQualityVersion: text(input.tradeQualityVersion, 'Trade Quality version'),
    riskPolicyVersion: text(input.riskPolicyVersion, 'risk policy version'),
    providerRequirements: {
      realProviderRequired: true,
      freshQuoteRequired: true,
      historicalCandlesRequired: 260,
      mockAllowed: false,
      paidServiceRequired: false,
      ...stable(input.providerRequirements ?? {}),
    },
    symbolUniverse,
    eligibilityRules: [...FORWARD_ELIGIBILITY_RULES],
    startingPaperAccount: {
      accountId: text(input.startingPaperAccount?.accountId, 'starting paper account id'),
      cash: finite(input.startingPaperAccount?.cash),
      buyingPower: finite(input.startingPaperAccount?.buyingPower),
      equity: finite(input.startingPaperAccount?.equity),
      revision: finite(input.startingPaperAccount?.revision, 0),
    },
    exitPolicy: {
      version: text(input.exitPolicy.version, 'exit policy version'),
      deterministic: true,
      manualConfirmationRequired: input.exitPolicy.manualConfirmationRequired !== false,
    },
    minimumSessions: FORWARD_OBSERVATION_MINIMUM_SESSIONS,
    minimumOutcomes: FORWARD_OBSERVATION_MINIMUM_OUTCOMES,
    boundaries: {
      paperOnly: true,
      noOptimizationDuringObservation: true,
      automaticExecution: false,
      liveTrading: false,
      automaticParameterChanges: false,
      automaticStrategyChanges: false,
      paidServiceRequired: false,
    },
  }
  if ([manifest.startingPaperAccount.cash, manifest.startingPaperAccount.buyingPower, manifest.startingPaperAccount.equity].some((value) => value === null)) throw new Error('starting paper account state is incomplete')
  const manifestFingerprint = fingerprint(configuration(manifest))
  return deepFreeze({ ...manifest, manifestFingerprint })
}

export function evaluateForwardObservationConfiguration(manifest, current = {}) {
  if (!manifest) return { compatible: false, status: 'NOT_STARTED', blockers: ['observation_manifest_not_started'] }
  const currentFingerprint = fingerprint(configuration({ ...manifest, ...current }))
  const compatible = currentFingerprint === manifest.manifestFingerprint
  return {
    compatible,
    status: compatible ? 'COLLECTING' : 'INVALIDATED',
    blockers: compatible ? [] : ['frozen_configuration_changed'],
    manifestFingerprint: manifest.manifestFingerprint,
    currentFingerprint,
  }
}

export function createForwardEvidenceSnapshot({ manifest, evidence = {}, tradeQuality = {}, entryContext = {} } = {}) {
  if (!manifest?.manifestFingerprint) throw new Error('forward observation manifest is required')
  if (evidence.forwardTestEligible !== true) throw new Error('only eligible forward evidence can enter the observation cohort')
  if (evidence.providerProvenance?.mock === true || evidence.providerProvenance?.dataStatus === 'MOCK') throw new Error('mock evidence cannot enter the observation cohort')
  if (String(evidence.providerProvenance?.dataStatus).toUpperCase() !== 'LIVE') throw new Error('fresh live provider evidence is required')
  const timestamp = iso(evidence.timestamp, 'evidence timestamp')
  const core = {
    version: FORWARD_EVIDENCE_SNAPSHOT_VERSION,
    observationId: manifest.observationId,
    manifestFingerprint: manifest.manifestFingerprint,
    symbol: text(evidence.symbol, 'evidence symbol').toUpperCase(),
    strategyId: text(evidence.strategyId, 'evidence strategy'),
    timestamp,
    provider: evidence.providerProvenance?.provider ?? 'unknown',
    quoteFreshness: evidence.providerProvenance?.dataStatus,
    marketRegime: stable(evidence.marketRegime ?? {}),
    strategySuitability: stable(evidence.strategySuitability ?? {}),
    tradeQuality: {
      score: finite(evidence.tradeQuality?.score),
      band: evidence.tradeQuality?.band ?? 'UNKNOWN',
      confidence: finite(evidence.tradeQuality?.confidence, 0),
      status: evidence.tradeQuality?.status ?? 'INSUFFICIENT_DATA',
      dimensions: stable(tradeQuality.dimensions ?? {}),
    },
    riskReward: finite(entryContext.riskReward),
    liquidityStatus: entryContext.liquidityStatus ?? 'UNKNOWN',
    blockers: [...new Set(evidence.blockers ?? [])],
    entryReference: finite(entryContext.referencePrice ?? evidence.entryReferenceContext?.referencePrice),
    stopReference: finite(entryContext.stopPrice),
    targetReference: finite(entryContext.targetPrice),
    paperEvaluationStatus: entryContext.paperEvaluationStatus ?? 'PENDING_HUMAN_REVIEW',
    engineVersions: {
      observation: FORWARD_OBSERVATION_VERSION,
      regime: manifest.regimeEngineVersion,
      strategySuitability: entryContext.strategySuitabilityVersion ?? null,
      tradeQuality: manifest.tradeQualityVersion,
      riskPolicy: manifest.riskPolicyVersion,
    },
    boundaries: { paperOnly: true, automaticExecution: false, liveTrading: false, rawCandlesStored: false, providerPayloadStored: false },
  }
  const evidenceFingerprint = fingerprint(core)
  return deepFreeze({ ...core, evidenceFingerprint })
}

function tradingSessions(snapshots = [], outcomes = []) {
  return new Set([...snapshots, ...outcomes].map((item) => item.timestamp ?? item.closedAt ?? item.evidenceTimestamp).filter(Boolean).map((value) => String(value).slice(0, 10))).size
}

function classification(review = {}, learning = {}, dataQualityDegraded = false) {
  if (dataQualityDegraded) return 'DEGRADED'
  const metrics = review.performance ?? {}
  if (review.recentTrend === 'DETERIORATING' || finite(metrics.expectancyPerTrade, 0) < 0 || finite(metrics.profitFactor, 0) < 0.9) return 'CAUTION'
  if (finite(metrics.expectancyPerTrade, 0) > 0 && finite(metrics.profitFactor, 0) >= 1.2 && review.recentTrend !== 'DETERIORATING' && learning.qualityCalibration?.status !== 'INVERTED') return 'PROMISING'
  return 'INCONCLUSIVE'
}

export function buildForwardObservationStatus({ manifest, manifestStatus = 'collecting', snapshots = [], outcomes = [], performanceReview = {}, learningEvidence = {}, currentConfiguration } = {}) {
  if (!manifest) {
    return {
      version: FORWARD_OBSERVATION_VERSION,
      status: 'NOT_STARTED',
      blockers: ['deterministic_exit_policy_required', 'strategy_lifecycle_not_active'],
      sessionsElapsed: 0,
      completedOutcomes: 0,
      minimumSessions: FORWARD_OBSERVATION_MINIMUM_SESSIONS,
      minimumOutcomes: FORWARD_OBSERVATION_MINIMUM_OUTCOMES,
      reviewClassification: null,
      boundaries: { paperOnly: true, noOptimizationDuringObservation: true, automaticExecution: false, liveTrading: false },
    }
  }
  const compatibility = evaluateForwardObservationConfiguration(manifest, currentConfiguration ?? configuration(manifest))
  const sessionsElapsed = tradingSessions(snapshots, outcomes)
  const completedOutcomes = finite(performanceReview.sample?.completedTrades, outcomes.length)
  const invalidated = String(manifestStatus).toLowerCase() === 'invalidated' || !compatibility.compatible
  let status = invalidated ? 'INVALIDATED' : 'COLLECTING'
  if (!invalidated && sessionsElapsed >= manifest.minimumSessions && completedOutcomes < manifest.minimumOutcomes) status = 'MINIMUM_OUTCOMES_PENDING'
  if (!invalidated && sessionsElapsed < manifest.minimumSessions && completedOutcomes >= manifest.minimumOutcomes) status = 'MINIMUM_SESSIONS_PENDING'
  if (!invalidated && sessionsElapsed >= manifest.minimumSessions && completedOutcomes >= manifest.minimumOutcomes) status = 'READY_FOR_REVIEW'
  const dataQualityDegraded = snapshots.some((item) => item.quoteFreshness !== 'LIVE' || /mock/i.test(item.provider))
  return {
    version: FORWARD_OBSERVATION_VERSION,
    observationId: manifest.observationId,
    manifestFingerprint: manifest.manifestFingerprint,
    status,
    sessionsElapsed,
    completedOutcomes,
    minimumSessions: manifest.minimumSessions,
    minimumOutcomes: manifest.minimumOutcomes,
    sessionProgressPct: Math.min(100, Math.round((sessionsElapsed / manifest.minimumSessions) * 100)),
    outcomeProgressPct: Math.min(100, Math.round((completedOutcomes / manifest.minimumOutcomes) * 100)),
    reviewClassification: status === 'READY_FOR_REVIEW' ? classification(performanceReview, learningEvidence, dataQualityDegraded) : null,
    metrics: performanceReview.performance ?? {},
    strategyPerformance: performanceReview.strategies ?? [],
    trendRegimePerformance: performanceReview.trendRegimes ?? [],
    volatilityRegimePerformance: performanceReview.volatilityRegimes ?? [],
    riskRegimePerformance: performanceReview.riskRegimes ?? [],
    tradeQualityCalibration: learningEvidence.qualityCalibration ?? { status: 'INSUFFICIENT_DATA' },
    symbolConcentration: performanceReview.symbols ?? [],
    blockers: invalidated ? compatibility.blockers : [],
    boundaries: manifest.boundaries,
  }
}
