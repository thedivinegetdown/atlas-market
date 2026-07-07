import { normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_LIFECYCLE_UPDATED_EVENT = 'strategy.lifecycle.updated'

export const STRATEGY_LIFECYCLE_STATES = Object.freeze(['draft', 'validated', 'active', 'paused', 'archived'])

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim() || fallback
}

function normalizeState(value, fallback = 'draft') {
  const state = normalizeText(value, fallback).toLowerCase()
  return STRATEGY_LIFECYCLE_STATES.includes(state) ? state : fallback
}

function normalizeSymbol(value) {
  return normalizeText(value, 'MARKET').toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function getBlueprint(input = {}) {
  return input.strategyBlueprintValidation?.blueprint ?? input.blueprint ?? {}
}

function buildValidationSnapshot(strategyBlueprintValidation = {}) {
  const blueprint = strategyBlueprintValidation.blueprint ?? {}
  return {
    eventType: strategyBlueprintValidation.eventType ?? null,
    validationStatus: strategyBlueprintValidation.validationStatus ?? 'draft',
    strategyId: blueprint.id ?? 'strategy-blueprint',
    strategyName: blueprint.name ?? 'Untitled Strategy Blueprint',
    version: blueprint.version ?? '0.1.0',
    entryConditionCount: blueprint.entryConditions?.length ?? 0,
    exitConditionCount: blueprint.exitConditions?.length ?? 0,
    riskRuleCount: blueprint.riskRuleReferences?.length ?? 0,
    timeframeReferences: blueprint.timeframeReferences ?? [],
    compatibleAssetClasses: blueprint.compatibleAssetClasses ?? [],
    blockers: strategyBlueprintValidation.blockers ?? [],
    cautions: strategyBlueprintValidation.cautions ?? [],
    paperTrading: true,
  }
}

function buildSignalComposerSnapshot(strategySignalComposition = {}) {
  const signal = strategySignalComposition.normalizedStrategySignal ?? {}
  return {
    eventType: strategySignalComposition.eventType ?? null,
    signalStatus: strategySignalComposition.signalStatus ?? 'missing',
    signalAction: signal.signalAction ?? 'none',
    signalDirection: signal.signalDirection ?? 'neutral',
    signalStrengthScore: numberValue(signal.signalStrengthScore ?? strategySignalComposition.signalStrengthScore),
    confidenceScore: numberValue(signal.confidenceScore ?? strategySignalComposition.confidenceScore),
    sourceRuleReferences: signal.sourceRuleReferences ?? strategySignalComposition.sourceRuleReferences ?? [],
    aiDecisionCompatible: signal.compatibleWithAIDecisionOrchestrator === true,
    rationaleSummary: signal.rationaleSummary ?? strategySignalComposition.rationaleSummary ?? 'No strategy signal composition available.',
    paperTrading: true,
  }
}

function buildResearchRegimeContextSnapshot(input = {}) {
  return {
    research: {
      eventType: input.researchDecisionContext?.eventType ?? input.researchSignalScore?.eventType ?? null,
      decisionBias: input.researchDecisionContext?.decisionBiasSummary?.decisionBias
        ?? input.researchSignalScore?.decisionBias
        ?? 'neutral',
      finalResearchScore: numberValue(
        input.researchDecisionContext?.researchScoreSummary?.finalResearchScore
          ?? input.researchSignalScore?.finalResearchScore,
        50,
      ),
    },
    marketRegime: {
      eventType: input.marketRegime?.eventType ?? null,
      compositeRegimeLabel: input.marketRegime?.compositeRegimeLabel ?? 'unknown',
      trendRegime: input.marketRegime?.trendRegime?.regime ?? 'sideways',
      riskRegime: input.marketRegime?.riskRegime?.regime ?? 'neutral',
      regimeConfidenceScore: numberValue(input.marketRegime?.regimeConfidenceScore, 50),
    },
    aiDecision: {
      eventType: input.researchEnhancedDecision?.eventType ?? input.aiDecision?.eventType ?? null,
      finalDecision: input.researchEnhancedDecision?.finalResearchAwareDecisionSummary?.finalDecision
        ?? input.aiDecision?.finalDecision
        ?? 'watchlist',
      confidenceScore: numberValue(
        input.researchEnhancedDecision?.finalResearchAwareDecisionSummary?.confidenceScore
          ?? input.aiDecision?.confidenceScore,
        50,
      ),
    },
    paperTrading: true,
  }
}

function buildActivationEligibility({ validationSnapshot, strategyRuleEvaluation = {}, signalComposerSnapshot, researchRegimeContextSnapshot }) {
  const checks = [
    {
      id: 'blueprint-validation',
      status: validationSnapshot.validationStatus === 'valid' ? 'pass' : validationSnapshot.validationStatus === 'caution' ? 'caution' : 'fail',
      summary: `Blueprint validation is ${validationSnapshot.validationStatus}.`,
    },
    {
      id: 'rule-evaluation',
      status: strategyRuleEvaluation.strategyEvaluationStatus === 'eligible' ? 'pass' : strategyRuleEvaluation.strategyEvaluationStatus === 'watchlist' ? 'caution' : 'fail',
      summary: `Strategy rules are ${strategyRuleEvaluation.strategyEvaluationStatus ?? 'missing'}.`,
    },
    {
      id: 'signal-composition',
      status: signalComposerSnapshot.signalStatus === 'composed' ? 'pass' : 'fail',
      summary: `Strategy signal is ${signalComposerSnapshot.signalStatus}.`,
    },
    {
      id: 'signal-confidence',
      status: signalComposerSnapshot.confidenceScore >= 60 ? 'pass' : signalComposerSnapshot.confidenceScore >= 45 ? 'caution' : 'fail',
      summary: `Signal confidence is ${signalComposerSnapshot.confidenceScore}.`,
    },
    {
      id: 'market-risk-regime',
      status: researchRegimeContextSnapshot.marketRegime.riskRegime === 'risk-off' ? 'fail' : 'pass',
      summary: `Market risk regime is ${researchRegimeContextSnapshot.marketRegime.riskRegime}.`,
    },
  ]
  const failed = checks.filter((check) => check.status === 'fail')
  const cautions = checks.filter((check) => check.status === 'caution')

  return {
    status: failed.length > 0 ? 'blocked' : cautions.length > 0 ? 'review' : 'eligible',
    checks,
    blockers: failed.map((check) => check.summary),
    cautions: cautions.map((check) => check.summary),
  }
}

function buildPauseRecommendation({ previousLifecycleState, strategyRuleEvaluation = {}, signalComposerSnapshot, researchRegimeContextSnapshot }) {
  const reasons = []
  if (strategyRuleEvaluation.strategyEvaluationStatus === 'watchlist') reasons.push('Strategy rules moved to watchlist')
  if (signalComposerSnapshot.signalAction === 'exit') reasons.push('Strategy signal composer produced an exit signal')
  if (signalComposerSnapshot.signalStatus === 'suppressed' && previousLifecycleState === 'active') reasons.push('Active strategy signal is suppressed')
  if (researchRegimeContextSnapshot.marketRegime.riskRegime === 'risk-off') reasons.push('Market regime is risk-off')
  if (researchRegimeContextSnapshot.aiDecision.finalDecision === 'reject') reasons.push('AI decision context is reject')

  return {
    recommended: reasons.length > 0,
    reasons,
    summary: reasons.length > 0 ? reasons.join('; ') : 'No pause recommendation for paper lifecycle.',
  }
}

function buildArchiveRecommendation({ requestedLifecycleState, validationSnapshot }) {
  const reasons = []
  if (requestedLifecycleState === 'archived') reasons.push('Archive requested by lifecycle input')
  if (validationSnapshot.validationStatus === 'invalid') reasons.push('Blueprint validation is invalid')

  return {
    recommended: reasons.length > 0,
    reasons,
    summary: reasons.length > 0 ? reasons.join('; ') : 'No archive recommendation for paper lifecycle.',
  }
}

function resolveLifecycleState({ requestedLifecycleState, previousLifecycleState, validationSnapshot, activationEligibility, pauseRecommendation, archiveRecommendation }) {
  if (requestedLifecycleState === 'archived') return 'archived'
  if (requestedLifecycleState === 'paused') return 'paused'
  if (requestedLifecycleState === 'active') {
    return activationEligibility.status === 'eligible' ? 'active' : previousLifecycleState === 'active' ? 'paused' : 'validated'
  }
  if (previousLifecycleState === 'active' && pauseRecommendation.recommended) return 'paused'
  if (archiveRecommendation.recommended && validationSnapshot.validationStatus === 'invalid') return 'draft'
  if (activationEligibility.status === 'eligible') return 'active'
  if (validationSnapshot.validationStatus === 'valid' || validationSnapshot.validationStatus === 'caution') return 'validated'
  return 'draft'
}

function buildLifecycleAuditEvent({ previousLifecycleState, lifecycleState, activationEligibility, pauseRecommendation, archiveRecommendation, timestamp }) {
  const reasons = [
    ...activationEligibility.blockers,
    ...activationEligibility.cautions,
    ...pauseRecommendation.reasons,
    ...archiveRecommendation.reasons,
  ]

  return {
    previousLifecycleState,
    lifecycleState,
    transition: previousLifecycleState === lifecycleState ? 'unchanged' : `${previousLifecycleState}->${lifecycleState}`,
    reasons,
    timestamp,
    paperTrading: true,
  }
}

export function updateStrategyLifecycle(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const blueprint = getBlueprint(input)
  const previousLifecycleState = normalizeState(input.previousLifecycleState ?? input.currentLifecycleState, 'draft')
  const requestedLifecycleState = input.requestedLifecycleState ? normalizeState(input.requestedLifecycleState, previousLifecycleState) : null
  const symbol = normalizeSymbol(input.strategyRuleEvaluation?.symbol ?? input.strategySignalComposition?.normalizedStrategySignal?.symbol ?? input.symbol)
  const assetType = normalizeAssetType(input.strategyRuleEvaluation?.assetType ?? input.strategySignalComposition?.normalizedStrategySignal?.assetType ?? input.assetType ?? 'equity')
  const validationSnapshot = buildValidationSnapshot(input.strategyBlueprintValidation)
  const signalComposerSnapshot = buildSignalComposerSnapshot(input.strategySignalComposition)
  const researchRegimeContextSnapshot = buildResearchRegimeContextSnapshot(input)
  const activationEligibility = buildActivationEligibility({
    validationSnapshot,
    strategyRuleEvaluation: input.strategyRuleEvaluation,
    signalComposerSnapshot,
    researchRegimeContextSnapshot,
  })
  const pauseRecommendation = buildPauseRecommendation({
    previousLifecycleState,
    strategyRuleEvaluation: input.strategyRuleEvaluation,
    signalComposerSnapshot,
    researchRegimeContextSnapshot,
  })
  const archiveRecommendation = buildArchiveRecommendation({
    requestedLifecycleState,
    validationSnapshot,
  })
  const lifecycleState = resolveLifecycleState({
    requestedLifecycleState,
    previousLifecycleState,
    validationSnapshot,
    activationEligibility,
    pauseRecommendation,
    archiveRecommendation,
  })
  const lifecycleAuditEvent = buildLifecycleAuditEvent({
    previousLifecycleState,
    lifecycleState,
    activationEligibility,
    pauseRecommendation,
    archiveRecommendation,
    timestamp,
  })
  const result = {
    eventType: STRATEGY_LIFECYCLE_UPDATED_EVENT,
    paperTrading: true,
    timestamp,
    strategyId: blueprint.id ?? validationSnapshot.strategyId,
    strategyName: blueprint.name ?? validationSnapshot.strategyName,
    symbol,
    assetType,
    previousLifecycleState,
    requestedLifecycleState,
    lifecycleState,
    activationEligibility,
    pauseRecommendation,
    archiveRecommendation,
    validationSnapshot,
    signalComposerSnapshot,
    researchRegimeContextSnapshot,
    lifecycleAuditEvent,
    summary: `${blueprint.name ?? validationSnapshot.strategyName} lifecycle is ${lifecycleState} for paper trading.`,
    sourceEvents: {
      strategyBlueprint: input.strategyBlueprintValidation?.eventType ?? null,
      strategyRuleEvaluation: input.strategyRuleEvaluation?.eventType ?? null,
      strategySignalComposition: input.strategySignalComposition?.eventType ?? null,
      researchDecisionContext: input.researchDecisionContext?.eventType ?? null,
      researchSignalScore: input.researchSignalScore?.eventType ?? null,
      marketRegime: input.marketRegime?.eventType ?? null,
      aiDecision: input.researchEnhancedDecision?.eventType ?? input.aiDecision?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_LIFECYCLE_UPDATED_EVENT, result)
  }

  return result
}

export function createStrategyLifecycleManager(options = {}) {
  return {
    update(input, updateOptions = {}) {
      return updateStrategyLifecycle(input, { ...options, ...updateOptions })
    },
  }
}
