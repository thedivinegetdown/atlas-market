import { normalizeAssetType } from '../assets/index.js'
import { eventBus as defaultEventBus } from '../core/eventBus.js'

export const MARKET_REGIME_CLASSIFIED_EVENT = 'market.regime.classified'

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

function classifyTrendRegime({ marketData = {}, researchIntelligence = {}, multiTimeframeContext = {} }) {
  const changePercent = numberValue(marketData.changePercent)
  const trendDirection = multiTimeframeContext.timeframeTrendSummary?.dominantDirection
    ?? researchIntelligence.trendContext?.direction
    ?? 'sideways'
  const alignment = numberValue(
    multiTimeframeContext.timeframeTrendSummary?.averageAlignment,
    researchIntelligence.trendContext?.score ?? 50,
  )
  const regime = trendDirection === 'upward' || changePercent >= 0.75 || alignment >= 65
    ? 'uptrend'
    : trendDirection === 'downward' || changePercent <= -0.75 || alignment <= 35
      ? 'downtrend'
      : 'sideways'

  return {
    regime,
    direction: trendDirection,
    changePercent: round(changePercent),
    alignmentScore: round(alignment),
    summary: `Trend regime is ${regime} with ${trendDirection} research direction.`,
  }
}

function classifyVolatilityRegime({ marketData = {}, researchIntelligence = {}, multiTimeframeContext = {} }) {
  const price = numberValue(marketData.price ?? marketData.last)
  const dailyRange = Math.abs(numberValue(marketData.high) - numberValue(marketData.low))
  const rangePct = price > 0 ? (dailyRange / price) * 100 : numberValue(researchIntelligence.volatilityContext?.rangePct)
  const volatilityScore = numberValue(
    multiTimeframeContext.timeframeVolatilitySummary?.averageScore,
    researchIntelligence.volatilityContext?.score ?? 50,
  )
  const label = multiTimeframeContext.timeframeVolatilitySummary?.overallLabel
    ?? researchIntelligence.volatilityContext?.label
    ?? 'normal'
  const regime = label === 'stressed' || rangePct >= 5 || volatilityScore <= 25
    ? 'extreme'
    : label === 'elevated' || rangePct >= 2.5 || volatilityScore <= 50
      ? 'elevated'
      : rangePct <= 0.75 && volatilityScore >= 75
        ? 'low'
        : 'normal'

  return {
    regime,
    sourceLabel: label,
    rangePct: round(rangePct),
    volatilityScore: round(volatilityScore),
    summary: `Volatility regime is ${regime}; range is ${round(rangePct)}%.`,
  }
}

function classifyRiskRegime({ researchIntelligence = {}, researchSignalScore = {}, multiTimeframeContext = {} }) {
  const sentimentLabel = multiTimeframeContext.timeframeBuckets?.find((item) => item.riskSentiment?.label)?.riskSentiment?.label
    ?? researchIntelligence.riskSentimentSummary?.label
    ?? researchSignalScore.riskSentimentAdjustment?.label
    ?? 'mixed'
  const score = numberValue(
    researchIntelligence.riskSentimentSummary?.score,
    researchSignalScore.riskSentimentAdjustment?.score ?? 50,
  )
  const dominantBias = multiTimeframeContext.dominantTimeframeBias?.bias ?? researchSignalScore.decisionBias ?? 'neutral'
  const regime = sentimentLabel === 'supportive' && dominantBias !== 'avoid' && score >= 60
    ? 'risk-on'
    : sentimentLabel === 'risk-off' || dominantBias === 'avoid' || score <= 40
      ? 'risk-off'
      : 'neutral'

  return {
    regime,
    sentimentLabel,
    sentimentScore: round(score),
    dominantBias,
    summary: `Risk regime is ${regime}; sentiment is ${sentimentLabel} and dominant bias is ${dominantBias}.`,
  }
}

function classifyLiquidityRegime({ marketData = {}, marketDataHealth = {} }) {
  const bid = numberValue(marketData.bid)
  const ask = numberValue(marketData.ask)
  const price = numberValue(marketData.price ?? marketData.last)
  const volume = numberValue(marketData.volume)
  const spreadPct = bid > 0 && ask > 0 && price > 0 ? ((ask - bid) / price) * 100 : 0
  const stale = marketDataHealth.stale === true
  const available = marketDataHealth.available !== false
  const regime = !available || stale || spreadPct > 0.35
    ? 'stressed'
    : volume > 0 && volume < 100000
      ? 'thin'
      : 'healthy'

  return {
    regime,
    spreadPct: round(spreadPct, 4),
    volume,
    marketDataAvailable: available,
    stale,
    summary: `Liquidity regime is ${regime}; spread is ${round(spreadPct, 4)}%.`,
  }
}

function buildCompositeRegimeLabel({ trendRegime, volatilityRegime, riskRegime, liquidityRegime }) {
  return `${trendRegime.regime}/${volatilityRegime.regime}/${riskRegime.regime}/${liquidityRegime.regime}`
}

function calculateRegimeConfidence({ trendRegime, volatilityRegime, riskRegime, liquidityRegime, multiTimeframeContext }) {
  const trendConfidence = trendRegime.regime === 'sideways' ? 60 : clamp(Math.abs(trendRegime.alignmentScore - 50) * 2)
  const volatilityConfidence = volatilityRegime.regime === 'normal' ? 65 : clamp(Math.abs(volatilityRegime.volatilityScore - 50) * 2)
  const riskConfidence = riskRegime.regime === 'neutral' ? 60 : clamp(Math.abs(riskRegime.sentimentScore - 50) * 2)
  const liquidityConfidence = liquidityRegime.regime === 'healthy' ? 78 : liquidityRegime.regime === 'thin' ? 60 : 45
  const conflictPenalty = multiTimeframeContext.conflictDetection?.hasConflicts ? 12 : 0
  const confidence = (
    trendConfidence * 0.3
    + volatilityConfidence * 0.2
    + riskConfidence * 0.3
    + liquidityConfidence * 0.2
    - conflictPenalty
  )

  return round(clamp(confidence, 5, 95))
}

function buildAiDecisionCompatibility({ symbol, assetType, trendRegime, riskRegime, confidenceScore, compositeRegimeLabel }) {
  const direction = riskRegime.regime === 'risk-off'
    ? 'neutral'
    : trendRegime.regime === 'uptrend'
      ? 'bullish'
      : trendRegime.regime === 'downtrend'
        ? 'bearish'
        : 'neutral'

  return {
    scannerSignal: {
      symbol,
      assetType,
      direction,
      score: confidenceScore,
      confidence: confidenceScore,
      source: 'market-regime-classifier',
    },
    signal: {
      source: 'market-regime-classifier',
      direction,
      score: confidenceScore,
      confidence: confidenceScore,
      strength: confidenceScore,
    },
    regimeLabel: compositeRegimeLabel,
    cautions: riskRegime.regime === 'risk-off' ? ['Market regime is risk-off'] : [],
    compatibleWithAIDecisionOrchestrator: true,
    paperTrading: true,
  }
}

export function classifyMarketRegime(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const marketData = input.marketData ?? input.quote ?? {}
  const marketDataHealth = input.marketDataHealth ?? input.marketDataAdapterHealth?.health ?? input.marketDataAdapterHealth ?? {}
  const researchIntelligence = input.researchIntelligence ?? input.marketIntelligence ?? {}
  const researchSignalScore = input.researchSignalScore ?? input.signalScore ?? {}
  const multiTimeframeContext = input.multiTimeframeResearchContext ?? input.multiTimeframeContext ?? {}
  const symbol = normalizeSymbol(input.symbol ?? marketData.symbol ?? researchIntelligence.symbol ?? multiTimeframeContext.symbol)
  const assetType = normalizeAssetType(input.assetType ?? marketData.assetType ?? researchIntelligence.assetType ?? multiTimeframeContext.assetType)
  const trendRegime = classifyTrendRegime({ marketData, researchIntelligence, multiTimeframeContext })
  const volatilityRegime = classifyVolatilityRegime({ marketData, researchIntelligence, multiTimeframeContext })
  const riskRegime = classifyRiskRegime({ researchIntelligence, researchSignalScore, multiTimeframeContext })
  const liquidityRegime = classifyLiquidityRegime({ marketData, marketDataHealth })
  const compositeRegimeLabel = buildCompositeRegimeLabel({
    trendRegime,
    volatilityRegime,
    riskRegime,
    liquidityRegime,
  })
  const regimeConfidenceScore = calculateRegimeConfidence({
    trendRegime,
    volatilityRegime,
    riskRegime,
    liquidityRegime,
    multiTimeframeContext,
  })
  const aiDecisionCompatibility = buildAiDecisionCompatibility({
    symbol,
    assetType,
    trendRegime,
    riskRegime,
    confidenceScore: regimeConfidenceScore,
    compositeRegimeLabel,
  })
  const result = {
    eventType: MARKET_REGIME_CLASSIFIED_EVENT,
    paperTrading: true,
    timestamp,
    symbol,
    assetType,
    trendRegime,
    volatilityRegime,
    riskRegime,
    liquidityRegime,
    compositeRegimeLabel,
    regimeConfidenceScore,
    aiDecisionCompatibility,
    summary: `${symbol} ${assetType} market regime classified as ${compositeRegimeLabel} with ${regimeConfidenceScore} confidence.`,
    sourceEvents: {
      marketDataAdapter: input.marketDataAdapterHealth?.eventType ?? input.marketDataHealth?.eventType ?? null,
      researchMarketIntelligence: researchIntelligence.eventType ?? null,
      researchSignalScore: researchSignalScore.eventType ?? null,
      multiTimeframeResearch: multiTimeframeContext.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(MARKET_REGIME_CLASSIFIED_EVENT, result)
  }

  return result
}

export function createMarketRegimeClassificationEngine(options = {}) {
  return {
    classify(input, evaluationOptions = {}) {
      return classifyMarketRegime(input, { ...options, ...evaluationOptions })
    },
  }
}
