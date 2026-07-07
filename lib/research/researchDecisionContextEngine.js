import { normalizeAssetType } from '../assets/index.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RESEARCH_DECISION_CONTEXT_PREPARED_EVENT = 'research.decisionContext.prepared'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? 'MARKET').trim().toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function buildResearchScoreSummary(signalScore = {}) {
  return {
    finalResearchScore: round(signalScore.finalResearchScore, 2),
    bullishScore: round(signalScore.bullishScore, 2),
    bearishScore: round(signalScore.bearishScore, 2),
    neutralScore: round(signalScore.neutralScore, 2),
    catalystStrengthScore: round(signalScore.catalystStrengthScore, 2),
    trendAlignmentScore: round(signalScore.trendAlignmentScore, 2),
    summary: signalScore.summary ?? 'Research signal score has not been evaluated.',
  }
}

function buildDecisionBiasSummary(signalScore = {}) {
  const decisionBias = signalScore.decisionBias ?? 'neutral'
  const finalResearchScore = numberValue(signalScore.finalResearchScore, 50)
  const recommendedUse = decisionBias === 'avoid'
    ? 'block_research_reliance'
    : decisionBias === 'bullish' || decisionBias === 'bearish'
      ? 'directional_context'
      : 'context_only'

  return {
    decisionBias,
    recommendedUse,
    directional: decisionBias === 'bullish' || decisionBias === 'bearish',
    avoid: decisionBias === 'avoid',
    confidenceBand: finalResearchScore >= 70 ? 'high' : finalResearchScore >= 45 ? 'medium' : 'low',
    summary: `Research decision bias is ${decisionBias}; use as ${recommendedUse}.`,
  }
}

function buildCatalystContextSummary(research = {}, signalScore = {}) {
  const catalystSummary = research.catalystSummary ?? {}
  const catalystStrength = signalScore.components?.catalystStrength ?? {}

  return {
    count: numberValue(catalystSummary.count),
    dominantSentiment: catalystSummary.dominantSentiment ?? catalystStrength.sentiment ?? 'neutral',
    averageConfidence: round(catalystSummary.averageConfidence, 2),
    strengthScore: round(signalScore.catalystStrengthScore, 2),
    sources: catalystSummary.sources ?? [],
    liveNewsConnected: catalystSummary.liveNewsConnected === true,
    paidApiRequired: catalystSummary.paidApiRequired === true,
    summary: catalystSummary.summary ?? catalystStrength.summary ?? 'No catalyst context supplied.',
  }
}

function buildMarketContextSummary(research = {}, signalScore = {}) {
  return {
    marketRegime: {
      label: research.marketRegimeSummary?.label ?? 'unknown',
      trendBias: research.marketRegimeSummary?.trendBias ?? 'unknown',
      exposureBias: research.marketRegimeSummary?.exposureBias ?? 'unknown',
      summary: research.marketRegimeSummary?.summary ?? 'No market regime summary supplied.',
    },
    volatility: {
      label: research.volatilityContext?.label ?? signalScore.volatilityAdjustment?.label ?? 'unknown',
      score: round(research.volatilityContext?.score ?? signalScore.volatilityAdjustment?.score, 2),
      adjustment: round(signalScore.volatilityAdjustment?.adjustment, 2),
      summary: signalScore.volatilityAdjustment?.summary ?? research.volatilityContext?.summary ?? 'No volatility context supplied.',
    },
    trend: {
      direction: research.trendContext?.direction ?? signalScore.components?.trendAlignment?.direction ?? 'sideways',
      score: round(research.trendContext?.score ?? signalScore.trendAlignmentScore, 2),
      alignmentScore: round(signalScore.trendAlignmentScore, 2),
      summary: signalScore.components?.trendAlignment?.summary ?? research.trendContext?.summary ?? 'No trend context supplied.',
    },
    riskSentiment: {
      label: research.riskSentimentSummary?.label ?? signalScore.riskSentimentAdjustment?.label ?? 'mixed',
      score: round(research.riskSentimentSummary?.score ?? signalScore.riskSentimentAdjustment?.score, 2),
      adjustment: round(signalScore.riskSentimentAdjustment?.adjustment, 2),
      summary: signalScore.riskSentimentAdjustment?.summary ?? research.riskSentimentSummary?.summary ?? 'No risk sentiment context supplied.',
    },
  }
}

function buildAiDecisionCompatibility({ symbol, assetType, signalScore, decisionBiasSummary, catalystContextSummary }) {
  const direction = decisionBiasSummary.decisionBias === 'bearish'
    ? 'bearish'
    : decisionBiasSummary.decisionBias === 'bullish'
      ? 'bullish'
      : 'neutral'
  const score = round(signalScore.finalResearchScore, 2)
  const confidence = Math.max(0, Math.min(100, Math.round((score * 0.7) + (numberValue(catalystContextSummary.averageConfidence, 50) * 0.3))))

  return {
    scannerSignal: {
      symbol,
      assetType,
      direction,
      score,
      confidence,
      source: 'research-decision-context',
    },
    signal: {
      source: 'research-decision-context',
      direction,
      score,
      confidence,
      strength: signalScore.catalystStrengthScore ?? 50,
    },
    cautions: decisionBiasSummary.avoid ? ['Research decision context recommends avoid'] : [],
    compatibleWithAIDecisionOrchestrator: true,
    paperTrading: true,
  }
}

function buildPreparedSummary({ symbol, assetType, decisionBiasSummary, researchScoreSummary }) {
  return `${symbol} ${assetType} research decision context prepared with ${decisionBiasSummary.decisionBias} bias and ${researchScoreSummary.finalResearchScore} final research score.`
}

export function prepareResearchDecisionContext(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const research = input.researchIntelligence ?? input.marketIntelligence ?? input.research ?? {}
  const signalScore = input.researchSignalScore ?? input.signalScore ?? {}
  const symbol = normalizeSymbol(input.symbol ?? signalScore.symbol ?? research.symbol)
  const assetType = normalizeAssetType(input.assetType ?? signalScore.assetType ?? research.assetType)
  const researchScoreSummary = buildResearchScoreSummary(signalScore)
  const decisionBiasSummary = buildDecisionBiasSummary(signalScore)
  const catalystContextSummary = buildCatalystContextSummary(research, signalScore)
  const marketContextSummary = buildMarketContextSummary(research, signalScore)
  const aiDecisionCompatibility = buildAiDecisionCompatibility({
    symbol,
    assetType,
    signalScore,
    decisionBiasSummary,
    catalystContextSummary,
  })
  const normalizedResearchContext = {
    symbol,
    assetType,
    paperTrading: true,
    researchBrief: research.researchBrief ?? null,
    researchScoreSummary,
    decisionBiasSummary,
    catalystContextSummary,
    marketContextSummary,
  }
  const result = {
    eventType: RESEARCH_DECISION_CONTEXT_PREPARED_EVENT,
    paperTrading: true,
    timestamp,
    symbol,
    assetType,
    normalizedResearchContext,
    researchScoreSummary,
    decisionBiasSummary,
    catalystContextSummary,
    marketContextSummary,
    aiDecisionCompatibility,
    summary: buildPreparedSummary({
      symbol,
      assetType,
      decisionBiasSummary,
      researchScoreSummary,
    }),
    sourceEvents: {
      researchMarketIntelligence: research.eventType ?? null,
      researchSignalScore: signalScore.eventType ?? null,
      aiDecision: input.aiDecision?.eventType ?? signalScore.sourceEvents?.aiDecision ?? research.sourceEvents?.aiDecision ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RESEARCH_DECISION_CONTEXT_PREPARED_EVENT, result)
  }

  return result
}

export function createResearchDecisionContextEngine(options = {}) {
  return {
    prepare(input, evaluationOptions = {}) {
      return prepareResearchDecisionContext(input, { ...options, ...evaluationOptions })
    },
  }
}
