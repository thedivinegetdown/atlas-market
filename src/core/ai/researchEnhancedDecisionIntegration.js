import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { orchestrateAIDecision } from './aiDecisionOrchestrator.js'

export const AI_DECISION_RESEARCH_ENHANCED_EVENT = 'ai.decision.researchEnhanced'

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

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeSymbol(symbol) {
  return String(symbol ?? 'MARKET').trim().toUpperCase()
}

function buildMarketIntelligenceSummary(marketIntelligence = {}) {
  return {
    eventType: marketIntelligence.eventType ?? null,
    symbol: marketIntelligence.symbol ?? 'MARKET',
    assetType: marketIntelligence.assetType ?? 'equity',
    marketRegime: marketIntelligence.marketRegimeSummary?.label ?? 'unknown',
    riskSentiment: marketIntelligence.riskSentimentSummary?.label ?? 'mixed',
    confidenceScore: round(marketIntelligence.confidenceScore, 2),
    brief: marketIntelligence.researchBrief ?? null,
  }
}

function buildResearchSignalScoreSummary(researchSignalScore = {}) {
  return {
    eventType: researchSignalScore.eventType ?? null,
    finalResearchScore: round(researchSignalScore.finalResearchScore, 2),
    decisionBias: researchSignalScore.decisionBias ?? 'neutral',
    bullishScore: round(researchSignalScore.bullishScore, 2),
    bearishScore: round(researchSignalScore.bearishScore, 2),
    neutralScore: round(researchSignalScore.neutralScore, 2),
  }
}

function buildResearchDecisionContextSummary(researchDecisionContext = {}) {
  return {
    eventType: researchDecisionContext.eventType ?? null,
    recommendedUse: researchDecisionContext.decisionBiasSummary?.recommendedUse ?? 'context_only',
    decisionBias: researchDecisionContext.decisionBiasSummary?.decisionBias ?? 'neutral',
    finalResearchScore: round(researchDecisionContext.researchScoreSummary?.finalResearchScore, 2),
    aiCompatible: researchDecisionContext.aiDecisionCompatibility?.compatibleWithAIDecisionOrchestrator === true,
  }
}

function buildMultiTimeframeSummary(multiTimeframeContext = {}) {
  return {
    eventType: multiTimeframeContext.eventType ?? null,
    dominantBias: multiTimeframeContext.dominantTimeframeBias?.bias ?? 'neutral',
    dominantTimeframe: multiTimeframeContext.dominantTimeframeBias?.dominantBucket ?? 'swing',
    averageResearchScore: round(multiTimeframeContext.timeframeResearchScoreAlignment?.averageScore, 2),
    hasConflicts: multiTimeframeContext.conflictDetection?.hasConflicts === true,
    conflictCount: numberValue(multiTimeframeContext.conflictDetection?.conflictCount),
  }
}

function buildMarketRegimeSummary(marketRegime = {}) {
  return {
    eventType: marketRegime.eventType ?? null,
    compositeRegimeLabel: marketRegime.compositeRegimeLabel ?? 'unknown',
    trendRegime: marketRegime.trendRegime?.regime ?? 'sideways',
    volatilityRegime: marketRegime.volatilityRegime?.regime ?? 'normal',
    riskRegime: marketRegime.riskRegime?.regime ?? 'neutral',
    liquidityRegime: marketRegime.liquidityRegime?.regime ?? 'healthy',
    confidenceScore: round(marketRegime.regimeConfidenceScore, 2),
  }
}

function collectResearchSignals({ researchDecisionContext = {}, multiTimeframeContext = {}, marketRegime = {} }) {
  return [
    researchDecisionContext.aiDecisionCompatibility?.scannerSignal,
    multiTimeframeContext.aiDecisionCompatibility?.scannerSignal,
    marketRegime.aiDecisionCompatibility?.scannerSignal,
  ].filter(Boolean)
}

function selectResearchSignal({ researchDecisionContext = {}, multiTimeframeContext = {}, marketRegime = {} }) {
  return researchDecisionContext.aiDecisionCompatibility?.signal
    ?? multiTimeframeContext.aiDecisionCompatibility?.signal
    ?? marketRegime.aiDecisionCompatibility?.signal
    ?? null
}

function calculateResearchInfluenceScore({ marketIntelligenceSummary, researchSignalSummary, decisionContextSummary, multiTimeframeSummary, marketRegimeSummary }) {
  const score = (
    numberValue(marketIntelligenceSummary.confidenceScore, 50) * 0.18
    + numberValue(researchSignalSummary.finalResearchScore, 50) * 0.24
    + numberValue(decisionContextSummary.finalResearchScore, 50) * 0.18
    + numberValue(multiTimeframeSummary.averageResearchScore, 50) * 0.22
    + numberValue(marketRegimeSummary.confidenceScore, 50) * 0.18
  )
  const conflictPenalty = multiTimeframeSummary.hasConflicts ? 10 : 0
  const riskPenalty = marketRegimeSummary.riskRegime === 'risk-off' ? 12 : 0

  return round(clamp(score - conflictPenalty - riskPenalty))
}

function buildAdjustment({ orchestratedDecision, researchSignalSummary, decisionContextSummary, multiTimeframeSummary, marketRegimeSummary, researchInfluenceScore }) {
  const blockers = []
  const cautions = []

  if (decisionContextSummary.recommendedUse === 'block_research_reliance') blockers.push('Research decision context recommends blocking research reliance')
  if (researchSignalSummary.decisionBias === 'avoid') blockers.push('Research signal score recommends avoid')
  if (multiTimeframeSummary.dominantBias === 'avoid') blockers.push('Multi-timeframe research context recommends avoid')
  if (marketRegimeSummary.riskRegime === 'risk-off') cautions.push('Market regime is risk-off')
  if (multiTimeframeSummary.hasConflicts) cautions.push('Research timeframes have conflicts')
  if (researchInfluenceScore < 45) cautions.push('Research influence score is weak')

  const finalDecision = orchestratedDecision.finalDecision === 'reject'
    ? 'reject'
    : blockers.length > 0
      ? 'watchlist'
      : cautions.length > 0 && orchestratedDecision.finalDecision === 'approve'
        ? 'caution'
        : orchestratedDecision.finalDecision

  return {
    finalDecision,
    blockers,
    cautions,
    rationale: finalDecision === orchestratedDecision.finalDecision
      ? `Research confirms ${orchestratedDecision.finalDecision} paper decision with ${researchInfluenceScore} influence score.`
      : `Research adjusts ${orchestratedDecision.finalDecision} to ${finalDecision}: ${[...blockers, ...cautions][0] ?? 'research context requires review'}.`,
  }
}

export function integrateResearchEnhancedDecision(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const marketIntelligence = input.marketIntelligence ?? input.researchIntelligence ?? {}
  const researchSignalScore = input.researchSignalScore ?? {}
  const researchDecisionContext = input.researchDecisionContext ?? {}
  const multiTimeframeContext = input.multiTimeframeContext ?? input.multiTimeframeResearchContext ?? {}
  const marketRegime = input.marketRegime ?? input.marketRegimeClassification ?? {}
  const researchScannerSignals = collectResearchSignals({ researchDecisionContext, multiTimeframeContext, marketRegime })
  const researchSignal = selectResearchSignal({ researchDecisionContext, multiTimeframeContext, marketRegime })
  const baseDecisionInput = input.baseDecisionInput ?? {}
  const orchestratedDecision = orchestrateAIDecision({
    ...baseDecisionInput,
    scannerSignals: [
      ...(baseDecisionInput.scannerSignals ?? []),
      ...researchScannerSignals,
    ],
    signal: researchSignal ?? baseDecisionInput.signal,
  }, { emitEvent: false })
  const marketIntelligenceSummary = buildMarketIntelligenceSummary(marketIntelligence)
  const researchSignalScoreSummary = buildResearchSignalScoreSummary(researchSignalScore)
  const researchDecisionContextSummary = buildResearchDecisionContextSummary(researchDecisionContext)
  const multiTimeframeContextSummary = buildMultiTimeframeSummary(multiTimeframeContext)
  const marketRegimeSummary = buildMarketRegimeSummary(marketRegime)
  const researchInfluenceScore = calculateResearchInfluenceScore({
    marketIntelligenceSummary,
    researchSignalSummary: researchSignalScoreSummary,
    decisionContextSummary: researchDecisionContextSummary,
    multiTimeframeSummary: multiTimeframeContextSummary,
    marketRegimeSummary,
  })
  const adjustment = buildAdjustment({
    orchestratedDecision,
    researchSignalSummary: researchSignalScoreSummary,
    decisionContextSummary: researchDecisionContextSummary,
    multiTimeframeSummary: multiTimeframeContextSummary,
    marketRegimeSummary,
    researchInfluenceScore,
  })
  const symbol = normalizeSymbol(orchestratedDecision.decisionInput?.symbol ?? marketIntelligence.symbol ?? marketRegime.symbol)
  const assetType = orchestratedDecision.decisionInput?.assetType ?? marketIntelligence.assetType ?? marketRegime.assetType ?? 'equity'
  const result = {
    eventType: AI_DECISION_RESEARCH_ENHANCED_EVENT,
    paperTrading: true,
    timestamp,
    symbol,
    assetType,
    orchestratedDecision,
    marketIntelligenceSummary,
    researchSignalScoreSummary,
    researchDecisionContextSummary,
    multiTimeframeContextSummary,
    marketRegimeSummary,
    researchInfluenceScore,
    finalResearchAwareDecisionSummary: {
      finalDecision: adjustment.finalDecision,
      baseDecision: orchestratedDecision.finalDecision,
      confidenceScore: orchestratedDecision.confidenceScore,
      researchInfluenceScore,
    },
    decisionAdjustmentRationale: adjustment.rationale,
    blockers: adjustment.blockers,
    cautions: adjustment.cautions,
    sourceEvents: {
      aiDecision: orchestratedDecision.eventType,
      marketIntelligence: marketIntelligence.eventType ?? null,
      researchSignalScore: researchSignalScore.eventType ?? null,
      researchDecisionContext: researchDecisionContext.eventType ?? null,
      multiTimeframeContext: multiTimeframeContext.eventType ?? null,
      marketRegime: marketRegime.eventType ?? null,
    },
    summary: `${symbol} ${assetType} research-enhanced AI decision is ${adjustment.finalDecision} with ${researchInfluenceScore} research influence.`,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(AI_DECISION_RESEARCH_ENHANCED_EVENT, result)
  }

  return result
}

export function createResearchEnhancedDecisionIntegration(options = {}) {
  return {
    integrate(input, integrationOptions = {}) {
      return integrateResearchEnhancedDecision(input, { ...options, ...integrationOptions })
    },
  }
}
