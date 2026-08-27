import { EDGE1_SYMBOL_UNIVERSE } from './forwardTestEvidence.js'
import { INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION } from './indexPullbackExitPolicy.js'
import { BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION } from './breakoutMomentumExitPolicy.js'
import { RANGE_MEAN_REVERSION_EXIT_POLICY_DEFINITION_FINGERPRINT, RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION } from './rangeMeanReversionExitPolicy.js'
import { VOLATILITY_EXPANSION_EXIT_POLICY_DEFINITION_FINGERPRINT, VOLATILITY_EXPANSION_EXIT_POLICY_VERSION } from './volatilityExpansionExitPolicy.js'

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

export const FORWARD_OBSERVATION_EXPERIMENT_VERSION = 'forward-observation-experiment-v2'
export const BREAKOUT_OBSERVATION_UNIVERSE = Object.freeze(['SPY', 'QQQ', 'IWM', 'AAPL', 'MSFT'])
export const RANGE_OBSERVATION_UNIVERSE = BREAKOUT_OBSERVATION_UNIVERSE

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

function manifestDefinitionCompatibility(manifest = {}) {
  const experiment = manifest.experiment ?? {}
  const experimentId = experiment.experimentId ?? 'EDGE.2'
  const consistent = experimentId === 'EDGE.2'
    ? manifest.exitPolicy?.version === INDEX_PULLBACK_EXIT_POLICY_VERSION && manifest.exitPolicy?.policyFingerprint === INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT
    : ['BREAKOUT.1', 'RANGE.1', 'VOL.1'].includes(experimentId)
      ? manifest.strategyVersions?.[experiment.strategyId] === experiment.strategyVersion
        && manifest.exitPolicy?.version === experiment.exitPolicyVersion
        && manifest.exitPolicy?.policyFingerprint === experiment.exitPolicyFingerprint
        && JSON.stringify(uniqueSorted(manifest.symbolUniverse)) === JSON.stringify(experiment.observationUniverse)
      : false
  return { compatible: consistent, blockers: consistent ? [] : ['persisted_manifest_definition_mismatch'] }
}

export function createForwardObservationExperimentDefinition(input = {}) {
  const experimentId = text(input.experimentId, 'experiment id')
  const strategyId = text(input.strategyId, 'strategy id')
  const strategyVersion = text(input.strategyVersion, 'strategy version')
  const observationUniverse = uniqueSorted(input.observationUniverse)
  if (!observationUniverse.length) throw new Error('observation universe is required')
  const exitPolicy = input.exitPolicy ?? {}
  if (exitPolicy.deterministic !== true) throw new Error('deterministic exit policy is required')
  const definition = { version: FORWARD_OBSERVATION_EXPERIMENT_VERSION, experimentId, strategyId, strategyVersion, strategyFingerprint: input.strategyFingerprint ?? null, exitPolicyId: text(exitPolicy.id ?? exitPolicy.version, 'exit policy id'), exitPolicyVersion: text(exitPolicy.version, 'exit policy version'), exitPolicyFingerprint: text(exitPolicy.policyFingerprint ?? exitPolicy.fingerprint, 'exit policy fingerprint'), observationUniverse, minimumTradingSessions: finite(input.minimumTradingSessions, FORWARD_OBSERVATION_MINIMUM_SESSIONS), minimumCompletedOutcomes: finite(input.minimumCompletedOutcomes, FORWARD_OBSERVATION_MINIMUM_OUTCOMES), allowedLifecycle: text(input.allowedLifecycle ?? 'paper_forward_observation', 'allowed lifecycle'), providerRequirements: stable(input.providerRequirements ?? {}), createdAt: iso(input.createdAt ?? new Date().toISOString(), 'experiment definition timestamp') }
  return deepFreeze({ ...definition, definitionFingerprint: fingerprint(definition) })
}

export function createBreakoutObservationExperimentDefinition(input = {}) {
  return createForwardObservationExperimentDefinition({ experimentId: 'BREAKOUT.1', strategyId: 'breakout-momentum-v1', strategyVersion: '1.0.0', strategyFingerprint: input.strategyFingerprint ?? null, observationUniverse: BREAKOUT_OBSERVATION_UNIVERSE, exitPolicy: { id: BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, version: BREAKOUT_MOMENTUM_EXIT_POLICY_VERSION, policyFingerprint: BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true }, createdAt: input.createdAt, ...input })
}

export function createRangeObservationExperimentDefinition(input = {}) {
  return createForwardObservationExperimentDefinition({ experimentId: 'RANGE.1', strategyId: 'range-mean-reversion-v1', strategyVersion: '1.0.0', strategyFingerprint: input.strategyFingerprint ?? null, observationUniverse: RANGE_OBSERVATION_UNIVERSE, exitPolicy: { id: RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION, version: RANGE_MEAN_REVERSION_EXIT_POLICY_VERSION, policyFingerprint: RANGE_MEAN_REVERSION_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true }, createdAt: input.createdAt, ...input })
}
export function createVolatilityObservationExperimentDefinition(input = {}) { return createForwardObservationExperimentDefinition({ experimentId: 'VOL.1', strategyId: 'volatility-expansion-v1', strategyVersion: '1.0.0', strategyFingerprint: input.strategyFingerprint ?? null, observationUniverse: BREAKOUT_OBSERVATION_UNIVERSE, exitPolicy: { id: VOLATILITY_EXPANSION_EXIT_POLICY_VERSION, version: VOLATILITY_EXPANSION_EXIT_POLICY_VERSION, policyFingerprint: VOLATILITY_EXPANSION_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true }, createdAt: input.createdAt, ...input }) }

function legacyEdgeDefinition(input) {
  return createForwardObservationExperimentDefinition({ experimentId: 'EDGE.2', strategyId: 'index-pullback-v1', strategyVersion: input.strategyVersions?.['index-pullback-v1'] ?? '1.2.0', observationUniverse: input.symbolUniverse ?? EDGE1_SYMBOL_UNIVERSE, exitPolicy: { id: input.exitPolicy?.version, version: input.exitPolicy?.version, policyFingerprint: input.exitPolicy?.policyFingerprint ?? input.exitPolicy?.fingerprint, deterministic: input.exitPolicy?.deterministic }, createdAt: input.startedAt })
}

export function createForwardObservationManifest(input = {}) {
  if (input.exitPolicy?.deterministic !== true) throw new Error('deterministic exit policy is required before the observation can start')
  const experiment = input.experimentDefinition ?? legacyEdgeDefinition(input)
  const startedAt = iso(input.startedAt, 'observation start timestamp')
  const symbolUniverse = uniqueSorted(input.symbolUniverse ?? experiment.observationUniverse)
  if (JSON.stringify(symbolUniverse) !== JSON.stringify(experiment.observationUniverse)) throw new Error('forward observation symbol universe must match the frozen experiment definition')
  const manifest = {
    version: FORWARD_OBSERVATION_VERSION,
    observationId: text(input.observationId, 'observation id'), experiment,
    startedAt,
    strategyVersions: stable(input.strategyVersions ?? { [experiment.strategyId]: experiment.strategyVersion }),
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
      policyFingerprint: text(input.exitPolicy.policyFingerprint ?? input.exitPolicy.fingerprint, 'exit policy fingerprint'),
      maximumHoldingSessions: finite(input.exitPolicy.maximumHoldingSessions),
      sameBarAmbiguity: text(input.exitPolicy.sameBarAmbiguity, 'same-bar ambiguity rule'),
      gapRule: text(input.exitPolicy.gapRule, 'gap rule'),
      liveTradingApproved: false,
    },
    minimumSessions: experiment.minimumTradingSessions,
    minimumOutcomes: experiment.minimumCompletedOutcomes,
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
  if (manifest.exitPolicy.version !== experiment.exitPolicyVersion || manifest.exitPolicy.policyFingerprint !== experiment.exitPolicyFingerprint) throw new Error('exit policy must match the frozen experiment definition')
  if (experiment.experimentId === 'EDGE.2' && (manifest.exitPolicy.version !== INDEX_PULLBACK_EXIT_POLICY_VERSION || manifest.exitPolicy.policyFingerprint !== INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT || manifest.exitPolicy.maximumHoldingSessions !== 20)) throw new Error('approved index-pullback exit policy is required')
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
  if (evidence.strategyId !== manifest.experiment?.strategyId) throw new Error('evidence strategy must match the frozen experiment definition')
  if (evidence.providerProvenance?.mock === true || evidence.providerProvenance?.dataStatus === 'MOCK') throw new Error('mock evidence cannot enter the observation cohort')
  if (String(evidence.providerProvenance?.dataStatus).toUpperCase() !== 'LIVE') throw new Error('fresh live provider evidence is required')
  if (entryContext.exitPolicy?.definitionFingerprint !== manifest.exitPolicy.policyFingerprint || entryContext.exitPolicy?.version !== manifest.exitPolicy.version) throw new Error('entry-time exit policy must match the frozen observation policy')
  const timestamp = iso(evidence.timestamp, 'evidence timestamp')
  const core = {
    version: FORWARD_EVIDENCE_SNAPSHOT_VERSION,
    observationId: manifest.observationId,
    experimentId: manifest.experiment?.experimentId ?? 'EDGE.2',
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
    exitPolicy: stable(entryContext.exitPolicy ?? {}),
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
      experimentId: null,
      strategyId: null,
      status: 'NOT_STARTED',
      blockers: ['observation_manifest_not_started'],
      sessionsElapsed: 0,
      completedOutcomes: 0,
      minimumSessions: FORWARD_OBSERVATION_MINIMUM_SESSIONS,
      minimumOutcomes: FORWARD_OBSERVATION_MINIMUM_OUTCOMES,
      reviewClassification: null,
      boundaries: { paperOnly: true, noOptimizationDuringObservation: true, automaticExecution: false, liveTrading: false },
    }
  }
  const compatibility = evaluateForwardObservationConfiguration(manifest, currentConfiguration ?? configuration(manifest))
  const definitionCompatibility = manifestDefinitionCompatibility(manifest)
  const sessionsElapsed = tradingSessions(snapshots, outcomes)
  const completedOutcomes = outcomes.length > 0 ? outcomes.filter((item) => item.exitAttribution?.countsTowardObservationMinimum !== false).length : finite(performanceReview.sample?.completedTrades, 0)
  const invalidated = String(manifestStatus).toLowerCase() === 'invalidated' || !compatibility.compatible || !definitionCompatibility.compatible
  let status = invalidated ? 'INVALIDATED' : 'COLLECTING'
  if (!invalidated && sessionsElapsed >= manifest.minimumSessions && completedOutcomes < manifest.minimumOutcomes) status = 'MINIMUM_OUTCOMES_PENDING'
  if (!invalidated && sessionsElapsed < manifest.minimumSessions && completedOutcomes >= manifest.minimumOutcomes) status = 'MINIMUM_SESSIONS_PENDING'
  if (!invalidated && sessionsElapsed >= manifest.minimumSessions && completedOutcomes >= manifest.minimumOutcomes) status = 'READY_FOR_REVIEW'
  const dataQualityDegraded = snapshots.some((item) => item.quoteFreshness !== 'LIVE' || /mock/i.test(item.provider))
  return {
    version: FORWARD_OBSERVATION_VERSION,
    observationId: manifest.observationId,
    experimentId: manifest.experiment?.experimentId ?? 'EDGE.2',
    strategyId: manifest.experiment?.strategyId ?? 'index-pullback-v1',
    strategyVersion: manifest.experiment?.strategyVersion ?? manifest.strategyVersions?.['index-pullback-v1'] ?? null,
    strategyFingerprint: manifest.experiment?.strategyFingerprint ?? null,
    exitPolicyId: manifest.experiment?.exitPolicyId ?? manifest.exitPolicy?.version ?? null,
    exitPolicyVersion: manifest.experiment?.exitPolicyVersion ?? manifest.exitPolicy?.version ?? null,
    exitPolicyFingerprint: manifest.experiment?.exitPolicyFingerprint ?? manifest.exitPolicy?.policyFingerprint ?? null,
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
    blockers: invalidated ? [...new Set([...compatibility.blockers, ...definitionCompatibility.blockers])] : [],
    reason: invalidated ? [...new Set([...compatibility.blockers, ...definitionCompatibility.blockers])][0] ?? 'observation_invalidated' : null,
    boundaries: manifest.boundaries,
  }
}
