import { normalizeAssetType } from '../assets/index.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT = 'research.multiTimeframeContext.evaluated'

export const RESEARCH_TIMEFRAME_BUCKETS = Object.freeze({
  INTRADAY: 'intraday',
  SWING: 'swing',
  POSITION: 'position',
})

const timeframeOrder = Object.freeze([
  RESEARCH_TIMEFRAME_BUCKETS.INTRADAY,
  RESEARCH_TIMEFRAME_BUCKETS.SWING,
  RESEARCH_TIMEFRAME_BUCKETS.POSITION,
])

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

function normalizeTimeframeBucket(bucket) {
  const normalized = String(bucket ?? '').trim().toLowerCase()
  return timeframeOrder.includes(normalized) ? normalized : RESEARCH_TIMEFRAME_BUCKETS.SWING
}

function getDecisionContext(entry = {}) {
  return entry.researchDecisionContext ?? entry.decisionContext ?? entry.context ?? {}
}

function getResearchIntelligence(entry = {}) {
  return entry.researchIntelligence ?? entry.marketIntelligence ?? entry.research ?? {}
}

function getResearchSignalScore(entry = {}) {
  return entry.researchSignalScore ?? entry.signalScore ?? {}
}

function normalizeTimeframeInput(entry = {}, fallbackBucket) {
  const bucket = normalizeTimeframeBucket(entry.bucket ?? entry.timeframe ?? fallbackBucket)
  const decisionContext = getDecisionContext(entry)
  const research = getResearchIntelligence(entry)
  const signalScore = getResearchSignalScore(entry)
  const marketContext = decisionContext.marketContextSummary ?? decisionContext.normalizedResearchContext?.marketContextSummary ?? {}
  const scoreSummary = decisionContext.researchScoreSummary ?? signalScore
  const decisionBiasSummary = decisionContext.decisionBiasSummary ?? {}

  return {
    bucket,
    label: entry.label ?? bucket,
    symbol: normalizeSymbol(entry.symbol ?? decisionContext.symbol ?? signalScore.symbol ?? research.symbol),
    assetType: normalizeAssetType(entry.assetType ?? decisionContext.assetType ?? signalScore.assetType ?? research.assetType),
    paperTrading: true,
    trend: {
      direction: marketContext.trend?.direction ?? research.trendContext?.direction ?? signalScore.components?.trendAlignment?.direction ?? 'sideways',
      score: round(marketContext.trend?.score ?? marketContext.trend?.alignmentScore ?? signalScore.trendAlignmentScore, 2),
      alignmentScore: round(marketContext.trend?.alignmentScore ?? signalScore.trendAlignmentScore, 2),
    },
    volatility: {
      label: marketContext.volatility?.label ?? signalScore.volatilityAdjustment?.label ?? research.volatilityContext?.label ?? 'unknown',
      score: round(marketContext.volatility?.score ?? signalScore.volatilityAdjustment?.score ?? research.volatilityContext?.score, 2),
      adjustment: round(marketContext.volatility?.adjustment ?? signalScore.volatilityAdjustment?.adjustment, 2),
    },
    riskSentiment: {
      label: marketContext.riskSentiment?.label ?? signalScore.riskSentimentAdjustment?.label ?? research.riskSentimentSummary?.label ?? 'mixed',
      score: round(marketContext.riskSentiment?.score ?? signalScore.riskSentimentAdjustment?.score ?? research.riskSentimentSummary?.score, 2),
    },
    researchScore: round(scoreSummary.finalResearchScore ?? signalScore.finalResearchScore, 2),
    decisionBias: decisionBiasSummary.decisionBias ?? signalScore.decisionBias ?? 'neutral',
    aiDecisionCompatibility: decisionContext.aiDecisionCompatibility ?? null,
    sourceEvents: {
      researchMarketIntelligence: research.eventType ?? decisionContext.sourceEvents?.researchMarketIntelligence ?? null,
      researchSignalScore: signalScore.eventType ?? decisionContext.sourceEvents?.researchSignalScore ?? null,
      researchDecisionContext: decisionContext.eventType ?? null,
    },
  }
}

function buildDefaultTimeframes(input = {}) {
  const sharedEntry = {
    researchIntelligence: input.researchIntelligence ?? input.marketIntelligence ?? input.research,
    researchSignalScore: input.researchSignalScore ?? input.signalScore,
    researchDecisionContext: input.researchDecisionContext ?? input.decisionContext,
  }

  return timeframeOrder.map((bucket) => ({
    ...sharedEntry,
    bucket,
    label: bucket,
  }))
}

function normalizeTimeframes(input = {}) {
  const rawTimeframes = Array.isArray(input.timeframes) && input.timeframes.length > 0
    ? input.timeframes
    : buildDefaultTimeframes(input)
  const byBucket = new Map()

  rawTimeframes.forEach((entry, index) => {
    const normalized = normalizeTimeframeInput(entry, timeframeOrder[index] ?? RESEARCH_TIMEFRAME_BUCKETS.SWING)
    byBucket.set(normalized.bucket, normalized)
  })

  return timeframeOrder.map((bucket) => byBucket.get(bucket)).filter(Boolean)
}

function summarizeTimeframeTrend(timeframes) {
  const counts = timeframes.reduce((acc, item) => {
    acc[item.trend.direction] = (acc[item.trend.direction] ?? 0) + 1
    return acc
  }, {})
  const averageAlignment = timeframes.length === 0
    ? 0
    : timeframes.reduce((sum, item) => sum + numberValue(item.trend.alignmentScore), 0) / timeframes.length
  const dominantDirection = Object.entries(counts).sort((left, right) => right[1] - left[1])[0]?.[0] ?? 'sideways'

  return {
    dominantDirection,
    averageAlignment: round(averageAlignment),
    byTimeframe: timeframes.map((item) => ({
      bucket: item.bucket,
      direction: item.trend.direction,
      alignmentScore: item.trend.alignmentScore,
    })),
    summary: `Dominant timeframe trend is ${dominantDirection} with ${round(averageAlignment)} average alignment.`,
  }
}

function summarizeTimeframeVolatility(timeframes) {
  const stressed = timeframes.filter((item) => item.volatility.label === 'stressed')
  const elevated = timeframes.filter((item) => item.volatility.label === 'elevated')
  const averageScore = timeframes.length === 0
    ? 0
    : timeframes.reduce((sum, item) => sum + numberValue(item.volatility.score), 0) / timeframes.length
  const overallLabel = stressed.length > 0 ? 'stressed' : elevated.length > 0 ? 'elevated' : 'contained'

  return {
    overallLabel,
    averageScore: round(averageScore),
    stressedBuckets: stressed.map((item) => item.bucket),
    byTimeframe: timeframes.map((item) => ({
      bucket: item.bucket,
      label: item.volatility.label,
      score: item.volatility.score,
      adjustment: item.volatility.adjustment,
    })),
    summary: `Multi-timeframe volatility is ${overallLabel} with ${round(averageScore)} average score.`,
  }
}

function summarizeResearchScoreAlignment(timeframes) {
  const scores = timeframes.map((item) => item.researchScore)
  const averageScore = scores.length === 0 ? 0 : scores.reduce((sum, score) => sum + numberValue(score), 0) / scores.length
  const minScore = scores.length === 0 ? 0 : Math.min(...scores)
  const maxScore = scores.length === 0 ? 0 : Math.max(...scores)
  const dispersion = maxScore - minScore
  const aligned = dispersion <= 20

  return {
    averageScore: round(averageScore),
    minScore: round(minScore),
    maxScore: round(maxScore),
    dispersion: round(dispersion),
    aligned,
    byTimeframe: timeframes.map((item) => ({
      bucket: item.bucket,
      researchScore: item.researchScore,
      decisionBias: item.decisionBias,
    })),
    summary: aligned
      ? `Research scores are aligned across timeframes with ${round(dispersion)} point dispersion.`
      : `Research scores conflict across timeframes with ${round(dispersion)} point dispersion.`,
  }
}

function detectTimeframeConflicts(timeframes, scoreAlignment) {
  const conflicts = []
  const bullishBuckets = timeframes.filter((item) => item.decisionBias === 'bullish').map((item) => item.bucket)
  const bearishBuckets = timeframes.filter((item) => item.decisionBias === 'bearish').map((item) => item.bucket)
  const avoidBuckets = timeframes.filter((item) => item.decisionBias === 'avoid').map((item) => item.bucket)
  const upwardBuckets = timeframes.filter((item) => item.trend.direction === 'upward').map((item) => item.bucket)
  const downwardBuckets = timeframes.filter((item) => item.trend.direction === 'downward').map((item) => item.bucket)

  if (bullishBuckets.length > 0 && bearishBuckets.length > 0) {
    conflicts.push({
      type: 'bias_conflict',
      severity: 'high',
      summary: `Bullish buckets (${bullishBuckets.join(', ')}) conflict with bearish buckets (${bearishBuckets.join(', ')}).`,
    })
  }
  if (upwardBuckets.length > 0 && downwardBuckets.length > 0) {
    conflicts.push({
      type: 'trend_conflict',
      severity: 'medium',
      summary: `Upward trend buckets (${upwardBuckets.join(', ')}) conflict with downward trend buckets (${downwardBuckets.join(', ')}).`,
    })
  }
  if (avoidBuckets.length > 0) {
    conflicts.push({
      type: 'avoid_bias',
      severity: 'high',
      summary: `Avoid bias present in ${avoidBuckets.join(', ')} timeframe${avoidBuckets.length === 1 ? '' : 's'}.`,
    })
  }
  if (!scoreAlignment.aligned) {
    conflicts.push({
      type: 'score_dispersion',
      severity: 'medium',
      summary: scoreAlignment.summary,
    })
  }

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
    conflictCount: conflicts.length,
  }
}

function determineDominantTimeframeBias(timeframes, conflicts) {
  const weights = {
    [RESEARCH_TIMEFRAME_BUCKETS.INTRADAY]: 0.2,
    [RESEARCH_TIMEFRAME_BUCKETS.SWING]: 0.35,
    [RESEARCH_TIMEFRAME_BUCKETS.POSITION]: 0.45,
  }
  const biasValues = {
    bullish: 1,
    neutral: 0,
    bearish: -1,
    avoid: -2,
  }
  const weightedScore = timeframes.reduce((sum, item) => {
    return sum + (numberValue(weights[item.bucket], 0.33) * numberValue(biasValues[item.decisionBias], 0))
  }, 0)
  const dominantBucket = [...timeframes]
    .sort((left, right) => numberValue(weights[right.bucket]) - numberValue(weights[left.bucket]))[0]?.bucket ?? RESEARCH_TIMEFRAME_BUCKETS.SWING
  const bias = conflicts.conflicts.some((item) => item.type === 'avoid_bias')
    ? 'avoid'
    : weightedScore >= 0.35
      ? 'bullish'
      : weightedScore <= -0.35
        ? 'bearish'
        : 'neutral'

  return {
    bias,
    dominantBucket,
    weightedScore: round(weightedScore, 4),
    summary: `Dominant multi-timeframe bias is ${bias}, led by ${dominantBucket} context.`,
  }
}

function buildAiDecisionCompatibility({ symbol, assetType, dominantBias, scoreAlignment, conflicts }) {
  const direction = dominantBias.bias === 'avoid' ? 'neutral' : dominantBias.bias
  const score = clamp(scoreAlignment.averageScore)
  const confidencePenalty = conflicts.hasConflicts ? 15 : 0
  const confidence = clamp(score - confidencePenalty)

  return {
    scannerSignal: {
      symbol,
      assetType,
      direction,
      score: round(score),
      confidence: round(confidence),
      source: 'multi-timeframe-research-context',
    },
    signal: {
      source: 'multi-timeframe-research-context',
      direction,
      score: round(score),
      confidence: round(confidence),
      strength: round(scoreAlignment.averageScore),
    },
    cautions: conflicts.conflicts.map((conflict) => conflict.summary),
    compatibleWithAIDecisionOrchestrator: true,
    paperTrading: true,
  }
}

export function evaluateMultiTimeframeResearchContext(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const timeframes = normalizeTimeframes(input)
  const symbol = normalizeSymbol(input.symbol ?? timeframes[0]?.symbol)
  const assetType = normalizeAssetType(input.assetType ?? timeframes[0]?.assetType)
  const timeframeTrendSummary = summarizeTimeframeTrend(timeframes)
  const timeframeVolatilitySummary = summarizeTimeframeVolatility(timeframes)
  const timeframeResearchScoreAlignment = summarizeResearchScoreAlignment(timeframes)
  const conflictDetection = detectTimeframeConflicts(timeframes, timeframeResearchScoreAlignment)
  const dominantTimeframeBias = determineDominantTimeframeBias(timeframes, conflictDetection)
  const aiDecisionCompatibility = buildAiDecisionCompatibility({
    symbol,
    assetType,
    dominantBias: dominantTimeframeBias,
    scoreAlignment: timeframeResearchScoreAlignment,
    conflicts: conflictDetection,
  })
  const finalMultiTimeframeDecisionContext = {
    symbol,
    assetType,
    paperTrading: true,
    decisionBias: dominantTimeframeBias.bias,
    dominantTimeframe: dominantTimeframeBias.dominantBucket,
    averageResearchScore: timeframeResearchScoreAlignment.averageScore,
    hasConflicts: conflictDetection.hasConflicts,
    compatibleWithAIDecisionOrchestrator: true,
  }
  const result = {
    eventType: RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    symbol,
    assetType,
    timeframeBuckets: timeframes,
    timeframeTrendSummary,
    timeframeVolatilitySummary,
    timeframeResearchScoreAlignment,
    conflictDetection,
    dominantTimeframeBias,
    finalMultiTimeframeDecisionContext,
    aiDecisionCompatibility,
    summary: `${symbol} ${assetType} multi-timeframe research context is ${dominantTimeframeBias.bias} with ${conflictDetection.conflictCount} conflict${conflictDetection.conflictCount === 1 ? '' : 's'}.`,
    sourceEvents: {
      researchMarketIntelligence: [...new Set(timeframes.map((item) => item.sourceEvents.researchMarketIntelligence).filter(Boolean))],
      researchSignalScore: [...new Set(timeframes.map((item) => item.sourceEvents.researchSignalScore).filter(Boolean))],
      researchDecisionContext: [...new Set(timeframes.map((item) => item.sourceEvents.researchDecisionContext).filter(Boolean))],
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RESEARCH_MULTI_TIMEFRAME_CONTEXT_EVALUATED_EVENT, result)
  }

  return result
}

export function createMultiTimeframeResearchContextEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateMultiTimeframeResearchContext(input, { ...options, ...evaluationOptions })
    },
  }
}
