import { composeQualifiedTradePlan } from '../qualifiedTradePlan/index.js'
import { createForwardTestEvidenceRecord } from './forwardTestEvidence.js'
import {
  BREAKOUT_OBSERVATION_UNIVERSE,
  createBreakoutObservationExperimentDefinition,
  createForwardEvidenceSnapshot,
  createForwardObservationExperimentDefinition,
  createForwardObservationManifest,
  createRangeObservationExperimentDefinition,
  createVolatilityObservationExperimentDefinition,
} from './forwardObservationEngine.js'
import { resolvePersistedForwardObservationStatuses, SUPPORTED_FORWARD_OBSERVATION_EXPERIMENTS } from './persistedObservationStatus.js'
import { createIndexPullbackExitPolicy, INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, INDEX_PULLBACK_EXIT_POLICY_VERSION, INDEX_PULLBACK_STRATEGY_VERSION } from './indexPullbackExitPolicy.js'
import { createBreakoutMomentumExitPolicy, BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT } from './breakoutMomentumExitPolicy.js'
import { createRangeMeanReversionExitPolicy, RANGE_MEAN_REVERSION_EXIT_POLICY_DEFINITION_FINGERPRINT } from './rangeMeanReversionExitPolicy.js'
import { createVolatilityExpansionExitPolicy, VOLATILITY_EXPANSION_EXIT_POLICY_DEFINITION_FINGERPRINT } from './volatilityExpansionExitPolicy.js'
import { BREAKOUT_MOMENTUM_STRATEGY_VERSION } from '../../strategies/breakout/breakoutMomentumSignal.js'
import { RANGE_MEAN_REVERSION_STRATEGY_VERSION } from '../../strategies/range/rangeMeanReversionSignal.js'
import { VOLATILITY_EXPANSION_STRATEGY_VERSION } from '../../strategies/volatility/volatilityExpansionSignal.js'

export const FORWARD_OBSERVATION_ORCHESTRATOR_VERSION = 'forward-observation-orchestrator-v1'

const EXPERIMENTS = Object.freeze({
  'EDGE.2': Object.freeze({ strategyVersion: INDEX_PULLBACK_STRATEGY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT }),
  'BREAKOUT.1': Object.freeze({ strategyVersion: BREAKOUT_MOMENTUM_STRATEGY_VERSION, policyFingerprint: BREAKOUT_MOMENTUM_EXIT_POLICY_DEFINITION_FINGERPRINT }),
  'RANGE.1': Object.freeze({ strategyVersion: RANGE_MEAN_REVERSION_STRATEGY_VERSION, policyFingerprint: RANGE_MEAN_REVERSION_EXIT_POLICY_DEFINITION_FINGERPRINT }),
  'VOL.1': Object.freeze({ strategyVersion: VOLATILITY_EXPANSION_STRATEGY_VERSION, policyFingerprint: VOLATILITY_EXPANSION_EXIT_POLICY_DEFINITION_FINGERPRINT }),
})

const sessionDate = (value) => String(value ?? '').slice(0, 10)
const byNewest = (left, right) => Date.parse(right.evaluatedAt) - Date.parse(left.evaluatedAt)

function definitionFor(experimentId, strategyFingerprint, createdAt) {
  if (experimentId === 'EDGE.2') {
    return createForwardObservationExperimentDefinition({
      experimentId,
      strategyId: 'index-pullback-v1',
      strategyVersion: INDEX_PULLBACK_STRATEGY_VERSION,
      strategyFingerprint,
      observationUniverse: BREAKOUT_OBSERVATION_UNIVERSE,
      exitPolicy: { id: INDEX_PULLBACK_EXIT_POLICY_VERSION, version: INDEX_PULLBACK_EXIT_POLICY_VERSION, policyFingerprint: INDEX_PULLBACK_EXIT_POLICY_DEFINITION_FINGERPRINT, deterministic: true },
      createdAt,
    })
  }
  if (experimentId === 'BREAKOUT.1') return createBreakoutObservationExperimentDefinition({ strategyFingerprint, createdAt })
  if (experimentId === 'RANGE.1') return createRangeObservationExperimentDefinition({ strategyFingerprint, createdAt })
  return createVolatilityObservationExperimentDefinition({ strategyFingerprint, createdAt })
}

function policyFor(experimentId, evaluation, strategyVersion) {
  const order = evaluation.orderContext ?? {}
  const common = { strategyId: evaluation.strategyId, strategyVersion, entryPrice: order.price, enteredAt: evaluation.evaluatedAt, strategyFingerprint: evaluation.strategyFingerprint ?? null }
  if (experimentId === 'EDGE.2') return createIndexPullbackExitPolicy({ ...common, side: order.side, stopPrice: order.stopPrice, targetPrice: order.targetPrice })
  if (experimentId === 'BREAKOUT.1') return createBreakoutMomentumExitPolicy({ ...common, breakoutLevel: evaluation.breakoutSignal?.prior20High, atr14: evaluation.breakoutSignal?.ATR14 })
  if (experimentId === 'RANGE.1') return createRangeMeanReversionExitPolicy({ ...common, prior20Low: evaluation.rangeMeanReversionSignal?.prior20Low, sma20: evaluation.rangeMeanReversionSignal?.SMA20, atr14: evaluation.rangeMeanReversionSignal?.ATR14 })
  return createVolatilityExpansionExitPolicy({ ...common, prior20High: evaluation.volatilityExpansionSignal?.prior20High, atr14: evaluation.volatilityExpansionSignal?.ATR14 })
}

function governedEvidence(evaluation, qualifiedPlan) {
  const regime = {
    engineVersion: evaluation.regime?.engineVersion ?? evaluation.engineVersions?.regime,
    asOf: evaluation.evaluatedAt,
    freshness: evaluation.freshness,
    marketData: evaluation.marketData,
    classification: {
      trendRegime: evaluation.regime?.trendRegime,
      volatilityRegime: evaluation.regime?.volatilityRegime,
      riskRegime: evaluation.regime?.riskRegime,
      status: evaluation.regime?.status,
      confidence: evaluation.regime?.confidence,
    },
  }
  const strategySuitability = {
    engineVersion: evaluation.strategySuitability?.engineVersion ?? evaluation.engineVersions?.strategySuitability,
    strategies: [{ strategyId: evaluation.strategyId, ...evaluation.strategySuitability }],
  }
  return createForwardTestEvidenceRecord({
    symbol: evaluation.symbol,
    timestamp: evaluation.evaluatedAt,
    regime,
    strategySuitability,
    tradeQuality: {
      ...evaluation.tradeQuality,
      strategyId: evaluation.strategyId,
      symbol: evaluation.symbol,
      freshness: evaluation.freshness,
      marketData: evaluation.marketData,
      blockingReasons: evaluation.blockers,
      missingInputs: evaluation.missingEvidence,
    },
    entryReferenceContext: { opportunityId: evaluation.candidateId, referencePrice: qualifiedPlan.structure.entry },
    providerProvenance: evaluation.marketData,
    riskGates: {
      evaluated: qualifiedPlan.decision.status === 'QUALIFIED',
      passed: qualifiedPlan.decision.status === 'QUALIFIED' && qualifiedPlan.risk.gateStatus !== 'BLOCKED',
      blockers: qualifiedPlan.risk.rejectionReasons,
    },
  })
}

function manifestFor({ experimentId, evaluation, account, exitPolicy }) {
  const experiment = EXPERIMENTS[experimentId]
  const definition = definitionFor(experimentId, evaluation.strategyFingerprint ?? exitPolicy.strategyFingerprint ?? null, evaluation.evaluatedAt)
  return createForwardObservationManifest({
    observationId: `${experimentId.toLowerCase()}-${sessionDate(evaluation.evaluatedAt)}`,
    startedAt: evaluation.evaluatedAt,
    experimentDefinition: definition,
    regimeEngineVersion: evaluation.regime?.engineVersion ?? evaluation.engineVersions?.regime ?? 'market-regime-v1',
    tradeQualityVersion: evaluation.tradeQuality?.engineVersion ?? evaluation.engineVersions?.tradeQuality ?? 'trade-quality-v1',
    riskPolicyVersion: evaluation.engineVersions?.riskPolicy ?? 'trade-guardrail-v1',
    startingPaperAccount: { accountId: account.accountId, cash: account.cash, buyingPower: account.buyingPower, equity: account.equity, revision: account.revision },
    exitPolicy: {
      version: exitPolicy.version,
      policyFingerprint: experiment.policyFingerprint,
      deterministic: true,
      manualConfirmationRequired: true,
      maximumHoldingSessions: exitPolicy.maximumHoldingSessions,
      sameBarAmbiguity: exitPolicy.sameBarAmbiguity,
      gapRule: exitPolicy.gapRule,
    },
  })
}

function boundedResult(experiment, before, after, details = {}) {
  return {
    experimentId: experiment.experimentId,
    statusBefore: before.status,
    statusAfter: after.status,
    sessionRecorded: details.sessionRecorded === true,
    validSessions: after.sessionsElapsed,
    requiredSessions: after.minimumSessions,
    completedOutcomes: after.completedOutcomes,
    requiredOutcomes: after.minimumOutcomes,
    empiricalConfidenceState: after.status === 'READY_FOR_REVIEW' ? 'READY_FOR_REVIEW' : 'UNAVAILABLE',
    qualifiedCohortEntryCreated: details.manifestCreated === true,
    reason: details.reason ?? after.reason ?? null,
  }
}

export async function runForwardObservation({ evidenceRepository, ledgerRepository, tenantContext, accountId, userId, now = new Date().toISOString() } = {}) {
  if (!evidenceRepository || !ledgerRepository) throw new Error('canonical observation repositories are required')
  const parsedNow = new Date(now)
  if (Number.isNaN(parsedNow.getTime())) throw new Error('observation timestamp is invalid')
  const scope = { tenantContext, accountId, userId: userId ?? tenantContext?.userId }
  const [evaluations, ledgerState, executions] = await Promise.all([
    evidenceRepository.listPaperEvaluations(scope),
    ledgerRepository.getOrCreateAccount(scope),
    ledgerRepository.listExecutions(scope),
  ])
  const before = await resolvePersistedForwardObservationStatuses({ ...scope, evidenceRepository, ledgerRepository, executions })
  const details = new Map()

  for (const experiment of SUPPORTED_FORWARD_OBSERVATION_EXPERIMENTS) {
    const prior = before.find((entry) => entry.experimentId === experiment.experimentId)
    if (prior.status === 'INVALIDATED' || prior.status === 'READY_FOR_REVIEW') continue
    const evaluation = evaluations
      .filter((item) => item.strategyId === experiment.strategyId && sessionDate(item.evaluatedAt) === sessionDate(parsedNow.toISOString()))
      .sort(byNewest)[0]
    if (!evaluation) {
      details.set(experiment.experimentId, { reason: 'no_current_governed_evaluation' })
      continue
    }
    const frozen = EXPERIMENTS[experiment.experimentId]
    const plan = composeQualifiedTradePlan({ evaluation, strategyVersion: frozen.strategyVersion, strategyFingerprint: evaluation.strategyFingerprint, policyFingerprint: frozen.policyFingerprint }, { generatedAt: evaluation.evaluatedAt })
    if (plan.decision.status !== 'QUALIFIED') {
      details.set(experiment.experimentId, { reason: `qualified_plan_${plan.decision.status.toLowerCase()}` })
      continue
    }
    const evidence = governedEvidence(evaluation, plan)
    if (!evidence.forwardTestEligible) {
      details.set(experiment.experimentId, { reason: evidence.blockers[0] ?? 'forward_evidence_ineligible' })
      continue
    }
    let exitPolicy
    try {
      exitPolicy = policyFor(experiment.experimentId, evaluation, frozen.strategyVersion)
    } catch (error) {
      details.set(experiment.experimentId, { reason: `exit_policy_evidence_incomplete:${error.message}` })
      continue
    }
    let persisted = await evidenceRepository.getForwardObservationManifest({ ...scope, experimentId: experiment.experimentId })
    let manifestCreated = false
    if (!persisted) {
      const manifest = manifestFor({ experimentId: experiment.experimentId, evaluation, account: ledgerState.account, exitPolicy })
      const saved = await evidenceRepository.saveForwardObservationManifest({ ...scope, manifest })
      if (!saved?.ok || saved.disabled === true) throw new Error('forward observation manifest was not durably persisted')
      manifestCreated = saved.created === true
      persisted = await evidenceRepository.getForwardObservationManifest({ ...scope, experimentId: experiment.experimentId })
        ?? { manifest, status: 'collecting' }
    }
    if (String(persisted.status).toLowerCase() !== 'collecting') {
      details.set(experiment.experimentId, { manifestCreated, reason: `observation_manifest_${String(persisted.status).toLowerCase()}` })
      continue
    }
    const snapshot = createForwardEvidenceSnapshot({
      manifest: persisted.manifest,
      evidence,
      tradeQuality: { dimensions: evaluation.tradeQuality?.dimensions ?? {} },
      entryContext: {
        riskReward: exitPolicy.rewardRiskRatio,
        liquidityStatus: 'PASSED_BY_QUALIFIED_PLAN',
        referencePrice: exitPolicy.entryPrice,
        stopPrice: exitPolicy.initialStop,
        targetPrice: exitPolicy.profitTarget,
        exitPolicy,
        paperEvaluationStatus: evaluation.status,
        strategySuitabilityVersion: evaluation.strategySuitability?.engineVersion ?? evaluation.engineVersions?.strategySuitability,
      },
    })
    const saved = await evidenceRepository.saveForwardEvidenceSnapshot({ ...scope, snapshot })
    if (!saved?.ok || saved.disabled === true) throw new Error('forward evidence snapshot was not durably persisted')
    details.set(experiment.experimentId, { manifestCreated, sessionRecorded: saved.created === true, reason: saved.duplicate ? 'duplicate_observation_suppressed' : null })
  }

  const after = await resolvePersistedForwardObservationStatuses({ ...scope, evidenceRepository, ledgerRepository, executions })
  const experiments = SUPPORTED_FORWARD_OBSERVATION_EXPERIMENTS.map((experiment) => boundedResult(
    experiment,
    before.find((entry) => entry.experimentId === experiment.experimentId),
    after.find((entry) => entry.experimentId === experiment.experimentId),
    details.get(experiment.experimentId),
  ))
  const sessionRecorded = experiments.some((entry) => entry.sessionRecorded)
  const ready = experiments.some((entry) => entry.statusAfter === 'READY_FOR_REVIEW')
  const invalidated = experiments.some((entry) => entry.statusAfter === 'INVALIDATED')
  return Object.freeze({
    version: FORWARD_OBSERVATION_ORCHESTRATOR_VERSION,
    observedAt: parsedNow.toISOString(),
    result: invalidated ? 'INVALIDATED' : ready ? 'READY_FOR_REVIEW' : sessionRecorded ? 'COLLECTING' : 'PASSIVE_WAIT',
    experiments,
    boundaries: { paperOnly: true, liveExecutionDisabled: true, automaticExecution: false, callerScientificInputsAccepted: false },
  })
}