import { eventBus as defaultEventBus } from '../core/eventBus.js'
import { normalizeAssetType } from '../assets/index.js'

export const RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT = 'research.marketIntelligence.evaluated'

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, numberValue(value)))
}

function getNowIso(now = new Date()) {
  const date = new Date(now)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function normalizeCatalysts(catalysts = []) {
  return catalysts.map((catalyst) => ({
    type: catalyst.type ?? 'placeholder',
    title: catalyst.title ?? 'No catalyst title provided',
    sentiment: catalyst.sentiment ?? 'neutral',
    confidence: clamp(catalyst.confidence ?? 50),
    source: catalyst.source ?? 'demo-research-input',
  }))
}

function summarizeCatalysts(catalysts = []) {
  const sentimentWeights = {
    positive: 1,
    bullish: 1,
    neutral: 0,
    mixed: 0,
    negative: -1,
    bearish: -1,
  }
  const sentimentScore = catalysts.reduce((sum, catalyst) => {
    return sum + (sentimentWeights[String(catalyst.sentiment).toLowerCase()] ?? 0)
  }, 0)
  const averageConfidence = catalysts.length === 0
    ? 0
    : catalysts.reduce((sum, catalyst) => sum + numberValue(catalyst.confidence, 50), 0) / catalysts.length
  const dominantSentiment = sentimentScore > 0 ? 'positive' : sentimentScore < 0 ? 'negative' : 'neutral'

  return {
    count: catalysts.length,
    dominantSentiment,
    averageConfidence: Number(averageConfidence.toFixed(2)),
    sources: [...new Set(catalysts.map((catalyst) => catalyst.source))],
    liveNewsConnected: false,
    paidApiRequired: false,
    summary: catalysts.length > 0
      ? `${catalysts.length} mock catalyst input${catalysts.length === 1 ? '' : 's'} reviewed with ${dominantSentiment} sentiment.`
      : 'No catalyst inputs supplied; research remains neutral by default.',
  }
}

function buildResearchInputSummary({ input, marketData, catalysts }) {
  const provider = input.marketDataProvider
    ?? input.marketDataAdapter?.provider
    ?? input.marketDataAdapterHealth?.provider
    ?? marketData.provider
    ?? 'mock-research-input'

  return {
    mode: 'mock',
    paperTrading: true,
    provider,
    marketDataEvent: input.marketDataAdapter?.eventType ?? input.marketDataAdapterHealth?.eventType ?? null,
    catalystInputType: catalysts.length > 0 ? 'operator-demo' : 'placeholder',
    liveNewsConnected: false,
    paidApiRequired: false,
    summary: `Research inputs are mock/demo only via ${provider}; no paid API or live news dependency is required.`,
  }
}

export function summarizeMarketRegime({ marketData = {}, portfolioAnalytics = {}, riskSnapshot = {} } = {}) {
  const changePercent = numberValue(marketData.changePercent)
  const grossExposure = numberValue(portfolioAnalytics.exposure?.grossExposure)
  const riskLevel = riskSnapshot.summary?.riskLevel ?? 'unknown'
  const trendBias = changePercent > 0.75 ? 'constructive' : changePercent < -0.75 ? 'defensive' : 'balanced'
  const exposureBias = grossExposure > 100 ? 'leveraged' : grossExposure > 70 ? 'invested' : 'cash-aware'
  const label = `${trendBias} ${exposureBias}`

  return {
    label,
    trendBias,
    exposureBias,
    riskLevel,
    summary: `Market regime is ${label} with ${riskLevel} portfolio risk.`,
  }
}

export function summarizeVolatilityContext({ marketData = {}, riskSnapshot = {} } = {}) {
  const dailyRange = Math.abs(numberValue(marketData.high) - numberValue(marketData.low))
  const price = numberValue(marketData.price ?? marketData.last)
  const rangePct = price > 0 ? (dailyRange / price) * 100 : numberValue(riskSnapshot.summary?.weightedVolatility)
  const portfolioVolatility = numberValue(riskSnapshot.summary?.weightedVolatility)
  const score = clamp(100 - Math.max(rangePct * 12, portfolioVolatility * 6))
  const label = score >= 70 ? 'contained' : score >= 45 ? 'elevated' : 'stressed'

  return {
    label,
    rangePct: Number(rangePct.toFixed(2)),
    portfolioVolatility: Number(portfolioVolatility.toFixed(2)),
    score: Number(score.toFixed(2)),
    summary: `Volatility is ${label}; daily range is ${Number(rangePct.toFixed(2))}%.`,
  }
}

export function summarizeTrendContext({ marketData = {}, aiDecision = {} } = {}) {
  const changePercent = numberValue(marketData.changePercent)
  const aiSignalScore = numberValue(aiDecision.signalQuality?.score, numberValue(aiDecision.confidenceScore, 50))
  const direction = changePercent > 0.4 || aiSignalScore >= 65
    ? 'upward'
    : changePercent < -0.4 || aiSignalScore <= 35
      ? 'downward'
      : 'sideways'
  const score = clamp(50 + changePercent * 8 + (aiSignalScore - 50) * 0.35)

  return {
    direction,
    score: Number(score.toFixed(2)),
    changePercent: Number(changePercent.toFixed(2)),
    aiSignalScore: Number(aiSignalScore.toFixed(2)),
    summary: `Trend context is ${direction} with AI signal quality at ${Number(aiSignalScore.toFixed(2))}.`,
  }
}

export function summarizeRiskSentiment({ riskSnapshot = {}, aiDecision = {}, releaseReadiness = {} } = {}) {
  const riskScore = numberValue(riskSnapshot.summary?.riskScore, 50)
  const aiDecisionStatus = aiDecision.finalDecision ?? 'watchlist'
  const releaseStatus = releaseReadiness.releaseReadinessStatus ?? 'unknown'
  const riskLevel = riskSnapshot.summary?.riskLevel ?? 'unknown'
  const releasePenalty = releaseStatus === 'ready' ? 0 : releaseStatus === 'caution' ? 10 : 25
  const decisionPenalty = aiDecisionStatus === 'reject' ? 20 : aiDecisionStatus === 'caution' ? 10 : 0
  const score = clamp(100 - riskScore - releasePenalty - decisionPenalty)
  const label = score >= 70 ? 'supportive' : score >= 45 ? 'mixed' : 'risk-off'

  return {
    label,
    score: Number(score.toFixed(2)),
    riskLevel,
    aiDecision: aiDecisionStatus,
    releaseStatus,
    summary: `Risk sentiment is ${label}; risk is ${riskLevel}, AI decision is ${aiDecisionStatus}, release gate is ${releaseStatus}.`,
  }
}

function calculateConfidence({ volatilityContext, trendContext, riskSentiment, catalysts }) {
  const catalystScore = catalysts.length === 0
    ? 55
    : catalysts.reduce((sum, catalyst) => sum + numberValue(catalyst.confidence, 50), 0) / catalysts.length
  const confidence = (
    numberValue(volatilityContext.score) * 0.25
    + numberValue(trendContext.score) * 0.3
    + numberValue(riskSentiment.score) * 0.3
    + catalystScore * 0.15
  )

  return Number(clamp(confidence, 5, 95).toFixed(2))
}

function summarizeDecisionReadiness({ confidenceScore, riskSentiment, releaseReadiness }) {
  const releaseStatus = releaseReadiness.releaseReadinessStatus ?? 'unknown'
  const ready = releaseStatus === 'ready'
    && riskSentiment.label !== 'risk-off'
    && confidenceScore >= 45

  return {
    readyForPaperDecision: ready,
    status: ready ? 'ready' : 'review',
    reason: ready
      ? 'Research context is acceptable for paper-decision review.'
      : 'Research context requires human review before paper-decision reliance.',
  }
}

function buildResearchBrief({
  symbol,
  assetType,
  marketRegime,
  volatilityContext,
  trendContext,
  riskSentiment,
  catalystSummary,
  researchInputSummary,
  confidenceScore,
}) {
  const catalystText = catalystSummary.count > 0
    ? catalystSummary.summary
    : 'no catalyst inputs supplied'

  return `${symbol} ${assetType} research context: ${marketRegime.summary} ${volatilityContext.summary} ${trendContext.summary} ${riskSentiment.summary} ${catalystText}. ${researchInputSummary.summary} Confidence ${confidenceScore}%.`
}

export function evaluateMarketIntelligence(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const marketData = input.marketData ?? {}
  const symbol = String(input.symbol ?? marketData.symbol ?? 'MARKET').toUpperCase()
  const assetType = normalizeAssetType(input.assetType ?? marketData.assetType ?? 'etf')
  const catalysts = normalizeCatalysts(input.catalysts ?? input.news ?? [])
  const catalystSummary = summarizeCatalysts(catalysts)
  const researchInputSummary = buildResearchInputSummary({ input, marketData, catalysts })
  const marketRegime = summarizeMarketRegime({
    marketData,
    portfolioAnalytics: input.portfolioAnalytics,
    riskSnapshot: input.riskSnapshot,
  })
  const volatilityContext = summarizeVolatilityContext({
    marketData,
    riskSnapshot: input.riskSnapshot,
  })
  const trendContext = summarizeTrendContext({
    marketData,
    aiDecision: input.aiDecision,
  })
  const riskSentiment = summarizeRiskSentiment({
    riskSnapshot: input.riskSnapshot,
    aiDecision: input.aiDecision,
    releaseReadiness: input.releaseReadiness,
  })
  const confidenceScore = calculateConfidence({
    volatilityContext,
    trendContext,
    riskSentiment,
    catalysts,
  })
  const decisionReadiness = summarizeDecisionReadiness({
    confidenceScore,
    riskSentiment,
    releaseReadiness: input.releaseReadiness ?? {},
  })
  const result = {
    eventType: RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    symbol,
    assetType,
    marketRegimeSummary: marketRegime,
    volatilityContext,
    trendContext,
    catalysts,
    catalystSummary,
    riskSentimentSummary: riskSentiment,
    researchInputSummary,
    confidenceScore,
    decisionReadiness,
    researchBrief: buildResearchBrief({
      symbol,
      assetType,
      marketRegime,
      volatilityContext,
      trendContext,
      riskSentiment,
      catalystSummary,
      researchInputSummary,
      confidenceScore,
    }),
    sourceEvents: {
      marketDataAdapter: input.marketDataAdapter?.eventType ?? input.marketDataAdapterHealth?.eventType ?? null,
      portfolioAnalytics: input.portfolioAnalytics?.eventType ?? null,
      portfolioRisk: input.riskSnapshot?.eventType ?? null,
      aiDecision: input.aiDecision?.eventType ?? null,
      releaseReadiness: input.releaseReadiness?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(RESEARCH_MARKET_INTELLIGENCE_EVALUATED_EVENT, result)
  }

  return result
}

export function createMarketIntelligenceEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateMarketIntelligence(input, { ...options, ...evaluationOptions })
    },
  }
}
