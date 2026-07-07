import { normalizeAssetType } from '../assets/index.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT = 'research.signalScore.evaluated'

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

function normalizeSymbol(symbol) {
  return String(symbol ?? 'MARKET').trim().toUpperCase()
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function scoreCatalystStrength(research = {}) {
  const catalystSummary = research.catalystSummary ?? {}
  const sentiment = String(catalystSummary.dominantSentiment ?? 'neutral').toLowerCase()
  const averageConfidence = numberValue(catalystSummary.averageConfidence, 50)
  const count = numberValue(catalystSummary.count)
  const countBoost = Math.min(12, count * 4)
  const sentimentAdjustment = sentiment === 'positive' ? 12 : sentiment === 'negative' ? -12 : 0
  const score = clamp(averageConfidence + countBoost + sentimentAdjustment)

  return {
    score: round(score),
    sentiment,
    catalystCount: count,
    summary: `${count} catalyst input${count === 1 ? '' : 's'} create ${sentiment} catalyst strength.`,
  }
}

function scoreVolatilityAdjustment(research = {}) {
  const volatility = research.volatilityContext ?? {}
  const score = clamp(volatility.score ?? 50)
  const adjustment = score >= 70 ? 8 : score >= 45 ? 0 : -18

  return {
    score: round(score),
    label: volatility.label ?? 'unknown',
    adjustment,
    summary: `Volatility context is ${volatility.label ?? 'unknown'} with ${round(score)} score.`,
  }
}

function scoreTrendAlignment(research = {}, aiDecision = {}) {
  const trend = research.trendContext ?? {}
  const direction = String(trend.direction ?? 'sideways').toLowerCase()
  const trendScore = clamp(trend.score ?? 50)
  const aiScore = clamp(aiDecision.signalQuality?.score ?? trend.aiSignalScore ?? research.confidenceScore ?? 50)
  const directionAdjustment = direction === 'upward' ? 10 : direction === 'downward' ? -10 : 0
  const score = clamp((trendScore * 0.65) + (aiScore * 0.35) + directionAdjustment)

  return {
    score: round(score),
    direction,
    aiSignalScore: round(aiScore),
    summary: `Trend alignment is ${direction} with AI signal quality at ${round(aiScore)}.`,
  }
}

function scoreRiskSentimentAdjustment(research = {}) {
  const riskSentiment = research.riskSentimentSummary ?? {}
  const label = String(riskSentiment.label ?? 'mixed').toLowerCase()
  const score = clamp(riskSentiment.score ?? 50)
  const adjustment = label === 'supportive' ? 10 : label === 'risk-off' ? -25 : -5

  return {
    score: round(score),
    label,
    adjustment,
    summary: `Risk sentiment is ${label} with ${round(score)} score.`,
  }
}

function scoreDirectionalContext({ catalystStrength, trendAlignment, riskSentimentAdjustment }) {
  const trendDirection = trendAlignment.direction
  const catalystSentiment = catalystStrength.sentiment
  const riskLabel = riskSentimentAdjustment.label
  const bullish = clamp(
    35
      + (trendDirection === 'upward' ? 25 : trendDirection === 'downward' ? -15 : 0)
      + (catalystSentiment === 'positive' ? 18 : catalystSentiment === 'negative' ? -12 : 0)
      + (riskLabel === 'supportive' ? 14 : riskLabel === 'risk-off' ? -20 : 0),
  )
  const bearish = clamp(
    25
      + (trendDirection === 'downward' ? 28 : trendDirection === 'upward' ? -12 : 0)
      + (catalystSentiment === 'negative' ? 18 : catalystSentiment === 'positive' ? -10 : 0)
      + (riskLabel === 'risk-off' ? 24 : riskLabel === 'supportive' ? -10 : 0),
  )
  const neutral = clamp(100 - Math.abs(bullish - bearish))

  return {
    bullishScore: round(bullish),
    bearishScore: round(bearish),
    neutralScore: round(neutral),
  }
}

function calculateFinalResearchScore({
  research,
  directionalScores,
  catalystStrength,
  volatilityAdjustment,
  trendAlignment,
  riskSentimentAdjustment,
}) {
  const directionalEdge = directionalScores.bullishScore - directionalScores.bearishScore
  const base = 50 + (directionalEdge * 0.25)
  const score = base
    + ((numberValue(research.confidenceScore, 50) - 50) * 0.2)
    + ((catalystStrength.score - 50) * 0.15)
    + ((trendAlignment.score - 50) * 0.2)
    + ((riskSentimentAdjustment.score - 50) * 0.15)
    + volatilityAdjustment.adjustment
    + riskSentimentAdjustment.adjustment

  return round(clamp(score, 0, 100))
}

function decideBias({ finalResearchScore, directionalScores, riskSentimentAdjustment, volatilityAdjustment, research }) {
  if (research.decisionReadiness?.readyForPaperDecision === false) return 'avoid'
  if (riskSentimentAdjustment.label === 'risk-off' && finalResearchScore < 55) return 'avoid'
  if (volatilityAdjustment.label === 'stressed' && finalResearchScore < 50) return 'avoid'
  if (directionalScores.bullishScore >= directionalScores.bearishScore + 12 && finalResearchScore >= 58) return 'bullish'
  if (directionalScores.bearishScore >= directionalScores.bullishScore + 12 && finalResearchScore <= 42) return 'bearish'
  return 'neutral'
}

function buildSummary({ symbol, assetType, decisionBias, finalResearchScore, catalystStrength, trendAlignment, riskSentimentAdjustment }) {
  return `${symbol} ${assetType} research signal score is ${finalResearchScore} with ${decisionBias} paper-trading bias. Catalyst strength is ${catalystStrength.sentiment}, trend alignment is ${trendAlignment.direction}, and risk sentiment is ${riskSentimentAdjustment.label}.`
}

export function evaluateResearchSignalScore(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const research = input.researchIntelligence ?? input.marketIntelligence ?? input.research ?? {}
  const aiDecision = input.aiDecision ?? {}
  const symbol = normalizeSymbol(input.symbol ?? research.symbol)
  const assetType = normalizeAssetType(input.assetType ?? research.assetType)
  const catalystStrength = scoreCatalystStrength(research)
  const volatilityAdjustment = scoreVolatilityAdjustment(research)
  const trendAlignment = scoreTrendAlignment(research, aiDecision)
  const riskSentimentAdjustment = scoreRiskSentimentAdjustment(research)
  const directionalScores = scoreDirectionalContext({
    catalystStrength,
    trendAlignment,
    riskSentimentAdjustment,
  })
  const finalResearchScore = calculateFinalResearchScore({
    research,
    directionalScores,
    catalystStrength,
    volatilityAdjustment,
    trendAlignment,
    riskSentimentAdjustment,
  })
  const decisionBias = decideBias({
    finalResearchScore,
    directionalScores,
    riskSentimentAdjustment,
    volatilityAdjustment,
    research,
  })
  const result = {
    eventType: RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    symbol,
    assetType,
    bullishScore: directionalScores.bullishScore,
    bearishScore: directionalScores.bearishScore,
    neutralScore: directionalScores.neutralScore,
    catalystStrengthScore: catalystStrength.score,
    volatilityAdjustment,
    trendAlignmentScore: trendAlignment.score,
    riskSentimentAdjustment,
    finalResearchScore,
    decisionBias,
    components: {
      catalystStrength,
      trendAlignment,
      directionalScores,
    },
    summary: buildSummary({
      symbol,
      assetType,
      decisionBias,
      finalResearchScore,
      catalystStrength,
      trendAlignment,
      riskSentimentAdjustment,
    }),
    sourceEvents: {
      researchMarketIntelligence: research.eventType ?? null,
      aiDecision: aiDecision.eventType ?? research.sourceEvents?.aiDecision ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RESEARCH_SIGNAL_SCORE_EVALUATED_EVENT, result)
  }

  return result
}

export function createResearchSignalScoringEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateResearchSignalScore(input, { ...options, ...evaluationOptions })
    },
  }
}
