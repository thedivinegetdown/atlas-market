import { calculateSuitabilityConfidence } from './calculateSuitabilityConfidence.js'
import { evaluateStrategyCompatibility } from './evaluateStrategyCompatibility.js'
import { normalizeStrategyMetadata } from './normalizeStrategyMetadata.js'
import { DEFAULT_STRATEGY_SUITABILITY_CONFIG } from './strategySuitabilityConfig.js'
import {
  ADAPTIVE_STRATEGY_ENGINE_VERSION,
  STRATEGY_SUITABILITY_DECISIONS,
  STRATEGY_SUITABILITY_STATUSES,
} from './strategySuitabilityTypes.js'

const DISABLED_LIFECYCLES = new Set(['archived', 'paused', 'disabled'])

function availableEvidence(regime = {}) {
  return new Set(regime.inputCoverage?.available ?? [])
}

function summarize(strategies) {
  return strategies.reduce((summary, strategy) => {
    const key = strategy.decision.toLowerCase()
    summary[key] += 1
    return summary
  }, { enabled: 0, conditional: 0, disabled: 0, unknown: 0 })
}

function resultStatus(regimeStatus) {
  if (regimeStatus === 'INVALID_INPUT') return STRATEGY_SUITABILITY_STATUSES.INVALID_INPUT
  if (regimeStatus === 'INSUFFICIENT_DATA') return STRATEGY_SUITABILITY_STATUSES.INSUFFICIENT_DATA
  if (regimeStatus === 'PARTIAL') return STRATEGY_SUITABILITY_STATUSES.PARTIAL
  return regimeStatus === 'COMPLETE'
    ? STRATEGY_SUITABILITY_STATUSES.COMPLETE
    : STRATEGY_SUITABILITY_STATUSES.INSUFFICIENT_DATA
}

function evaluateOne(strategyInput, regime, config) {
  const strategy = normalizeStrategyMetadata(strategyInput)
  const classification = regime.classification ?? {}
  const rules = config.strategies[strategy.strategyId]
  const reasons = []
  const blockingReasons = []
  const configuredRequirements = rules?.requiredIndicators ?? []
  const requiredIndicators = [...new Set([...configuredRequirements, ...strategy.requiredIndicators])]
  const evidence = availableEvidence(regime)
  const missingInputs = requiredIndicators.filter((input) => !evidence.has(input))

  if (!strategy.strategyId || !rules) {
    return {
      strategyId: strategy.strategyId || 'unknown',
      strategyName: strategy.strategyName,
      decision: STRATEGY_SUITABILITY_DECISIONS.UNKNOWN,
      confidence: 0,
      reasons: ['No approved adaptive suitability rules exist for this strategy'],
      blockingReasons: [],
      missingInputs,
      lifecycleState: strategy.lifecycleState,
    }
  }

  if (DISABLED_LIFECYCLES.has(strategy.lifecycleState) || DISABLED_LIFECYCLES.has(strategy.status)) {
    blockingReasons.push(`Strategy lifecycle is ${strategy.lifecycleState || strategy.status}`)
  }
  if (strategy.activationEligibilityStatus === 'blocked') blockingReasons.push('Existing lifecycle activation eligibility is blocked')
  if (strategy.validationStatus === 'invalid') blockingReasons.push('Existing strategy validation is invalid')

  const stale = regime.freshness === 'STALE' || (regime.inputCoverage?.stale?.length ?? 0) > 0
  const invalidOrInsufficient = ['INVALID_INPUT', 'INSUFFICIENT_DATA'].includes(classification.status)
  if (stale) reasons.push('Market regime evidence is materially stale')
  if (invalidOrInsufficient) reasons.push(`Market regime status is ${classification.status}`)

  const compatibility = evaluateStrategyCompatibility(classification, rules)
  reasons.push(...compatibility.map((item) => item.reason))
  blockingReasons.push(...compatibility.filter((item) => item.status === 'incompatible').map((item) => item.reason))
  if (missingInputs.length > 0) reasons.push(`Missing required evidence: ${missingInputs.join(', ')}`)
  const missingBlocking = strategy.blockingPrerequisites.filter((input) => missingInputs.includes(input))
  blockingReasons.push(...missingBlocking.map((input) => `Blocking prerequisite ${input} is missing`))

  const confidence = calculateSuitabilityConfidence({
    regimeConfidence: classification.confidence,
    regimeStatus: classification.status,
    missingInputs,
    lifecycleState: strategy.lifecycleState,
    config,
  })

  let decision
  if (blockingReasons.length > 0) decision = STRATEGY_SUITABILITY_DECISIONS.DISABLED
  else if (invalidOrInsufficient || stale || compatibility.some((item) => item.status === 'unknown')) decision = STRATEGY_SUITABILITY_DECISIONS.UNKNOWN
  else if (
    classification.status === 'PARTIAL'
    || strategy.lifecycleState !== 'active'
    || missingInputs.length > 0
    || compatibility.some((item) => item.status === 'conditional')
    || confidence < config.preferredConfidence
  ) decision = STRATEGY_SUITABILITY_DECISIONS.CONDITIONAL
  else decision = STRATEGY_SUITABILITY_DECISIONS.ENABLED

  if (confidence < config.minimumConfidence && decision === STRATEGY_SUITABILITY_DECISIONS.ENABLED) {
    decision = STRATEGY_SUITABILITY_DECISIONS.CONDITIONAL
  }
  reasons.push(`Suitability confidence is ${confidence}`)
  if (strategy.lifecycleState !== 'active') reasons.push(`Strategy lifecycle remains ${strategy.lifecycleState}; selection cannot activate it`)

  return {
    strategyId: strategy.strategyId,
    strategyName: strategy.strategyName,
    decision,
    confidence,
    reasons,
    blockingReasons,
    missingInputs,
    lifecycleState: strategy.lifecycleState,
  }
}

export function selectStrategiesForRegime({
  regime = {},
  strategies = [],
  context = {},
} = {}, options = {}) {
  const startedAt = Date.now()
  const config = options.config ?? DEFAULT_STRATEGY_SUITABILITY_CONFIG
  const evaluatedStrategies = strategies.map((strategy) => evaluateOne(strategy, regime, config))
  const summary = summarize(evaluatedStrategies)
  const result = {
    engineVersion: ADAPTIVE_STRATEGY_ENGINE_VERSION,
    regimeVersion: regime.engineVersion ?? 'unknown',
    status: resultStatus(regime.classification?.status),
    asOf: regime.asOf ?? null,
    symbol: regime.symbol ?? context.symbol ?? null,
    timeframe: regime.timeframe ?? context.timeframe ?? null,
    marketData: regime.marketData,
    regime: {
      trendRegime: regime.classification?.trendRegime ?? 'UNKNOWN',
      volatilityRegime: regime.classification?.volatilityRegime ?? 'UNKNOWN',
      riskRegime: regime.classification?.riskRegime ?? 'UNKNOWN',
      confidence: regime.classification?.confidence ?? 0,
      status: regime.classification?.status ?? 'INSUFFICIENT_DATA',
      freshness: regime.freshness ?? 'UNKNOWN',
      marketData: regime.marketData,
    },
    strategies: evaluatedStrategies,
    summary,
    boundaries: { paperTradingOnly: true, advisoryOnly: true, automaticActivation: false },
  }
  options.logger?.info?.('adaptive strategy suitability evaluated', {
    engineVersion: result.engineVersion,
    regimeStatus: result.regime.status,
    ...summary,
    missingEvidenceCount: evaluatedStrategies.reduce((count, strategy) => count + strategy.missingInputs.length, 0),
    durationMs: Date.now() - startedAt,
  })
  return result
}
