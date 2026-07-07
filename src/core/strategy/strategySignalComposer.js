import { normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_SIGNAL_COMPOSED_EVENT = 'strategy.signal.composed'

function normalizeText(value, fallback = '') {
  return String(value ?? fallback).trim() || fallback
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

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, numberValue(value)))
}

function getBlueprint(input = {}) {
  return input.strategyBlueprintValidation?.blueprint ?? input.blueprint ?? {}
}

function getRuleEvaluation(input = {}) {
  return input.strategyRuleEvaluation ?? input.ruleEvaluation ?? {}
}

function getResearchBias(input = {}) {
  return input.researchDecisionContext?.decisionBiasSummary?.decisionBias
    ?? input.researchSignalScore?.decisionBias
    ?? 'neutral'
}

function getResearchScore(input = {}) {
  return numberValue(
    input.researchDecisionContext?.researchScoreSummary?.finalResearchScore
      ?? input.researchSignalScore?.finalResearchScore,
    50,
  )
}

function getAiDecision(input = {}) {
  return input.researchEnhancedDecision?.finalResearchAwareDecisionSummary?.finalDecision
    ?? input.aiDecision?.finalDecision
    ?? 'watchlist'
}

function getAiConfidence(input = {}) {
  return numberValue(
    input.researchEnhancedDecision?.finalResearchAwareDecisionSummary?.confidenceScore
      ?? input.aiDecision?.confidenceScore,
    50,
  )
}

function deriveSignalAction(ruleEvaluation = {}) {
  if (ruleEvaluation.strategyEvaluationStatus === 'blocked') return 'none'
  if (ruleEvaluation.exitRuleEvaluation?.status === 'pass') return 'exit'
  if (ruleEvaluation.strategyEvaluationStatus === 'eligible') return 'entry'
  return 'none'
}

function deriveSignalDirection({ signalAction, researchBias, marketRegime = {}, aiDecision }) {
  if (signalAction === 'exit') {
    if (researchBias === 'bearish' || marketRegime.riskRegime?.regime === 'risk-off') return 'bearish'
    return 'neutral'
  }
  if (signalAction !== 'entry') return 'neutral'
  if (researchBias === 'bullish' || researchBias === 'bearish') return researchBias
  if (marketRegime.trendRegime?.regime === 'uptrend') return 'bullish'
  if (marketRegime.trendRegime?.regime === 'downtrend') return 'bearish'
  if (aiDecision === 'approve') return 'bullish'
  return 'neutral'
}

function calculateRulePassScore(ruleEvaluation = {}) {
  const buckets = [
    ruleEvaluation.entryRuleEvaluation,
    ruleEvaluation.riskRuleEvaluation,
    ruleEvaluation.timeframeCompatibility,
    ruleEvaluation.assetClassCompatibility,
  ]
  const statuses = buckets.flatMap((bucket) => {
    if (!bucket) return []
    if (Array.isArray(bucket.rules)) return bucket.rules.map((rule) => rule.status)
    return [bucket.status]
  })
  if (statuses.length === 0) return 0
  const score = statuses.reduce((total, status) => {
    if (status === 'pass') return total + 100
    if (status === 'caution') return total + 55
    return total
  }, 0) / statuses.length
  return round(score)
}

function calculateSignalStrength({ signalAction, ruleEvaluation, researchScore, marketRegime, aiDecision }) {
  if (signalAction === 'none') return 0
  const rulePassScore = calculateRulePassScore(ruleEvaluation)
  const regimeConfidence = numberValue(marketRegime.regimeConfidenceScore, 50)
  const aiDecisionBoost = aiDecision === 'approve' ? 8 : aiDecision === 'watchlist' || aiDecision === 'caution' ? 3 : -10
  const exitBoost = signalAction === 'exit' ? 6 : 0
  return round(clamp((rulePassScore * 0.45) + (researchScore * 0.35) + (regimeConfidence * 0.2) + aiDecisionBoost + exitBoost))
}

function calculateConfidence({ signalAction, ruleEvaluation, input }) {
  if (signalAction === 'none') return ruleEvaluation.strategyEvaluationStatus === 'blocked' ? 15 : 35
  const rulePassScore = calculateRulePassScore(ruleEvaluation)
  const aiConfidence = getAiConfidence(input)
  const regimeConfidence = numberValue(input.marketRegime?.regimeConfidenceScore, 50)
  const researchInfluence = numberValue(input.researchEnhancedDecision?.researchInfluenceScore, getResearchScore(input))
  return round(clamp((rulePassScore * 0.35) + (aiConfidence * 0.25) + (regimeConfidence * 0.2) + (researchInfluence * 0.2)))
}

function collectSourceRuleReferences(ruleEvaluation = {}, signalAction) {
  const entryRules = ruleEvaluation.entryRuleEvaluation?.rules ?? []
  const exitRules = ruleEvaluation.exitRuleEvaluation?.rules ?? []
  const riskRules = ruleEvaluation.riskRuleEvaluation?.rules ?? []
  const activeRules = signalAction === 'exit'
    ? exitRules.filter((rule) => rule.status === 'pass')
    : signalAction === 'entry'
      ? entryRules.filter((rule) => rule.status === 'pass')
      : []
  return [...activeRules, ...riskRules.filter((rule) => rule.status === 'pass')].map((rule) => ({
    id: rule.id,
    type: rule.type ?? rule.engine ?? 'rule',
    status: rule.status,
    source: rule.source ?? rule.reference ?? null,
  }))
}

function buildRationale({ signalAction, signalDirection, signalStrengthScore, ruleEvaluation, researchBias, aiDecision }) {
  if (signalAction === 'none') {
    return `Strategy signal suppressed because rule evaluation is ${ruleEvaluation.strategyEvaluationStatus ?? 'unavailable'}.`
  }
  const side = signalAction === 'entry' ? 'entry' : 'exit'
  return `Composed ${side} ${signalDirection} paper strategy signal with ${signalStrengthScore} strength from ${researchBias} research bias and ${aiDecision} AI decision.`
}

export function composeStrategySignal(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const blueprint = getBlueprint(input)
  const ruleEvaluation = getRuleEvaluation(input)
  const symbol = normalizeSymbol(ruleEvaluation.symbol ?? input.symbol ?? input.researchDecisionContext?.symbol)
  const assetType = normalizeAssetType(ruleEvaluation.assetType ?? input.assetType ?? input.researchDecisionContext?.assetType ?? 'equity')
  const timeframe = normalizeText(ruleEvaluation.timeframe ?? input.timeframe ?? 'swing', 'swing').toLowerCase()
  const signalAction = deriveSignalAction(ruleEvaluation)
  const researchBias = getResearchBias(input)
  const aiDecision = getAiDecision(input)
  const signalDirection = deriveSignalDirection({
    signalAction,
    researchBias,
    marketRegime: input.marketRegime,
    aiDecision,
  })
  const researchScore = getResearchScore(input)
  const signalStrengthScore = calculateSignalStrength({
    signalAction,
    ruleEvaluation,
    researchScore,
    marketRegime: input.marketRegime ?? {},
    aiDecision,
  })
  const confidenceScore = calculateConfidence({ signalAction, ruleEvaluation, input })
  const sourceRuleReferences = collectSourceRuleReferences(ruleEvaluation, signalAction)
  const rationaleSummary = buildRationale({
    signalAction,
    signalDirection,
    signalStrengthScore,
    ruleEvaluation,
    researchBias,
    aiDecision,
  })
  const signalStatus = signalAction === 'none' ? 'suppressed' : 'composed'
  const normalizedStrategySignal = {
    strategyId: ruleEvaluation.strategyId ?? blueprint.id ?? 'strategy-blueprint',
    strategyName: ruleEvaluation.strategyName ?? blueprint.name ?? 'Untitled Strategy Blueprint',
    symbol,
    assetType,
    timeframe,
    signalAction,
    signalDirection,
    signalStrengthScore,
    confidenceScore,
    rationaleSummary,
    sourceRuleReferences,
    compatibleWithAIDecisionOrchestrator: signalStatus === 'composed',
    paperTrading: true,
  }
  const result = {
    eventType: STRATEGY_SIGNAL_COMPOSED_EVENT,
    paperTrading: true,
    timestamp,
    signalStatus,
    normalizedStrategySignal,
    entrySignalComposition: {
      active: signalAction === 'entry',
      direction: signalAction === 'entry' ? signalDirection : 'neutral',
      strengthScore: signalAction === 'entry' ? signalStrengthScore : 0,
      sourceRules: signalAction === 'entry' ? sourceRuleReferences : [],
    },
    exitSignalComposition: {
      active: signalAction === 'exit',
      direction: signalAction === 'exit' ? signalDirection : 'neutral',
      strengthScore: signalAction === 'exit' ? signalStrengthScore : 0,
      sourceRules: signalAction === 'exit' ? sourceRuleReferences : [],
    },
    signalDirection,
    signalStrengthScore,
    confidenceScore,
    rationaleSummary,
    sourceRuleReferences,
    summary: `${normalizedStrategySignal.strategyName} strategy signal ${signalStatus}: ${signalAction} ${signalDirection}.`,
    sourceEvents: {
      strategyBlueprint: input.strategyBlueprintValidation?.eventType ?? null,
      strategyRuleEvaluation: ruleEvaluation.eventType ?? null,
      researchDecisionContext: input.researchDecisionContext?.eventType ?? null,
      researchSignalScore: input.researchSignalScore?.eventType ?? null,
      marketRegime: input.marketRegime?.eventType ?? null,
      aiDecision: input.researchEnhancedDecision?.eventType ?? input.aiDecision?.eventType ?? null,
      portfolioRisk: input.portfolioRisk?.eventType ?? null,
      positionSizing: input.positionSizing?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_SIGNAL_COMPOSED_EVENT, result)
  }

  return result
}

export function createStrategySignalComposer(options = {}) {
  return {
    compose(input, composeOptions = {}) {
      return composeStrategySignal(input, { ...options, ...composeOptions })
    },
  }
}
