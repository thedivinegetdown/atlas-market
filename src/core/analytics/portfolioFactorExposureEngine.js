import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT = 'portfolio.factorExposure.evaluated'

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

function normalizeSymbol(value) {
  return String(value ?? '').trim().toUpperCase()
}

function getPortfolioAnalytics(input = {}) {
  return input.portfolioAnalytics ?? input.analytics ?? {}
}

function getPortfolioCorrelation(input = {}) {
  return input.portfolioCorrelation ?? input.correlation ?? {}
}

function getStrategyAttribution(input = {}) {
  return input.strategyAttribution ?? input.attribution ?? {}
}

function getMarketRegime(input = {}) {
  return input.marketRegime ?? input.marketRegimeClassification ?? {}
}

function getBacktestPerformance(input = {}) {
  return input.strategyBacktestPerformance ?? input.backtestPerformance ?? {}
}

function buildFactorMetadata(input = {}) {
  const metadata = new Map()
  const add = (item = {}) => {
    const symbol = normalizeSymbol(item.symbol)
    if (!symbol) return
    metadata.set(symbol, {
      symbol,
      beta: numberValue(item.beta, metadata.get(symbol)?.beta ?? 1),
      volatility: numberValue(item.volatility, metadata.get(symbol)?.volatility ?? 1),
      momentumScore: numberValue(item.momentumScore ?? item.momentum ?? item.trendScore, metadata.get(symbol)?.momentumScore ?? 50),
    })
  }

  for (const position of input.positions ?? input.portfolio?.positions ?? []) add(position)
  for (const item of input.factorInputs ?? input.assetFactorInputs ?? []) add(item)

  return metadata
}

function getSymbolExposures(portfolioAnalytics = {}, factorMetadata = new Map()) {
  return (portfolioAnalytics.exposure?.bySymbol ?? []).map((item) => {
    const symbol = normalizeSymbol(item.symbol)
    const metadata = factorMetadata.get(symbol) ?? {}
    return {
      symbol,
      assetType: item.assetType ?? 'unknown',
      sector: item.sector ?? 'Unclassified',
      weight: numberValue(item.weight),
      beta: numberValue(metadata.beta, 1),
      volatility: numberValue(metadata.volatility, 1),
      momentumScore: numberValue(metadata.momentumScore, 50),
    }
  }).filter((item) => item.symbol)
}

function weightedAverage(items = [], key) {
  const totalWeight = items.reduce((sum, item) => sum + Math.abs(numberValue(item.weight)), 0)
  if (totalWeight === 0) return 0
  return items.reduce((sum, item) => sum + (numberValue(item[key]) * Math.abs(numberValue(item.weight))), 0) / totalWeight
}

function classifyExposure(value, thresholds) {
  if (value >= thresholds.elevated) return 'elevated'
  if (value >= thresholds.caution) return 'caution'
  return 'clear'
}

function summarizeMarketBetaExposure(symbolExposures = [], marketRegime = {}) {
  const weightedBeta = round(weightedAverage(symbolExposures, 'beta'), 4)
  const highBetaWeight = round(symbolExposures
    .filter((item) => item.beta >= 1.2)
    .reduce((sum, item) => sum + numberValue(item.weight), 0))
  const regimeAdjustment = marketRegime.riskRegime?.regime === 'risk-off' ? 10 : marketRegime.trendRegime?.regime === 'uptrend' ? -3 : 0
  const exposureScore = round(clamp((weightedBeta * 45) + (highBetaWeight * 0.45) + regimeAdjustment))

  return {
    weightedBeta,
    highBetaWeight,
    regimeAdjustment,
    exposureScore,
    status: classifyExposure(exposureScore, { caution: 55, elevated: 75 }),
  }
}

function summarizeMomentumFactorExposure(symbolExposures = [], marketRegime = {}) {
  const weightedMomentumScore = round(weightedAverage(symbolExposures, 'momentumScore'))
  const proMomentumWeight = round(symbolExposures
    .filter((item) => item.momentumScore >= 60)
    .reduce((sum, item) => sum + numberValue(item.weight), 0))
  const trendRegime = marketRegime.trendRegime?.regime ?? 'sideways'
  const trendAlignment = trendRegime === 'uptrend' ? 'aligned' : trendRegime === 'downtrend' ? 'opposed' : 'neutral'
  const concentrationScore = round(clamp((proMomentumWeight * 0.65) + (weightedMomentumScore * 0.35)))

  return {
    weightedMomentumScore,
    proMomentumWeight,
    trendRegime,
    trendAlignment,
    exposureScore: concentrationScore,
    status: classifyExposure(concentrationScore, { caution: 60, elevated: 78 }),
  }
}

function summarizeVolatilityFactorExposure(symbolExposures = [], marketRegime = {}) {
  const weightedVolatility = round(weightedAverage(symbolExposures, 'volatility'), 4)
  const highVolatilityWeight = round(symbolExposures
    .filter((item) => item.volatility >= 2)
    .reduce((sum, item) => sum + numberValue(item.weight), 0))
  const regime = marketRegime.volatilityRegime?.regime ?? 'normal'
  const regimeAdjustment = regime === 'extreme' ? 15 : regime === 'elevated' ? 8 : regime === 'low' ? -5 : 0
  const exposureScore = round(clamp((weightedVolatility * 22) + (highVolatilityWeight * 0.55) + regimeAdjustment))

  return {
    weightedVolatility,
    highVolatilityWeight,
    volatilityRegime: regime,
    regimeAdjustment,
    exposureScore,
    status: classifyExposure(exposureScore, { caution: 55, elevated: 75 }),
  }
}

function summarizeBucketExposure(items = [], keyName, labelName) {
  const totalWeight = items.reduce((sum, item) => sum + numberValue(item.weight), 0)
  const dominant = [...items].sort((left, right) => numberValue(right.weight) - numberValue(left.weight))[0] ?? null
  const concentrationScore = round(dominant?.weight ?? 0)

  return {
    totalWeight: round(totalWeight),
    dominantFactor: dominant ? {
      [labelName]: dominant[keyName],
      weight: round(dominant.weight),
      count: numberValue(dominant.count),
    } : null,
    factors: items.map((item) => ({
      [labelName]: item[keyName],
      weight: round(item.weight),
      count: numberValue(item.count),
    })),
    concentrationScore,
    status: classifyExposure(concentrationScore, { caution: 35, elevated: 50 }),
  }
}

function summarizeSectorFactorExposure(portfolioAnalytics = {}, portfolioCorrelation = {}) {
  const sectors = portfolioAnalytics.exposure?.bySector ?? []
  const correlationBySector = new Map((portfolioCorrelation.sectorCorrelationSummary ?? []).map((item) => [item.sector, item]))
  const enriched = sectors.map((sector) => {
    const correlation = correlationBySector.get(sector.name) ?? {}
    const correlationBoost = numberValue(correlation.averageInternalCorrelation) * 15
    return {
      sector: sector.name,
      weight: round(sector.weight),
      count: numberValue(sector.count),
      averageInternalCorrelation: correlation.averageInternalCorrelation ?? null,
      factorScore: round(clamp(numberValue(sector.weight) + correlationBoost)),
    }
  })
  const dominant = [...enriched].sort((left, right) => right.factorScore - left.factorScore)[0] ?? null

  return {
    dominantSector: dominant,
    sectors: enriched,
    concentrationScore: round(dominant?.factorScore ?? 0),
    status: classifyExposure(dominant?.factorScore ?? 0, { caution: 35, elevated: 50 }),
  }
}

function summarizeAssetClassFactorExposure(portfolioAnalytics = {}) {
  const assetClasses = (portfolioAnalytics.exposure?.byAssetClass ?? []).map((item) => ({
    assetType: item.assetType,
    weight: round(item.weight),
    count: numberValue(item.count),
  }))
  return summarizeBucketExposure(assetClasses, 'assetType', 'assetType')
}

function summarizeStrategyFactorExposure(strategyAttribution = {}, backtestPerformance = {}) {
  const backtestPnl = numberValue(backtestPerformance.metrics?.netRealizedPnl)
  const strategies = (strategyAttribution.strategies ?? []).map((strategy) => {
    const qualityScore = clamp(
      (numberValue(strategy.winRate) * 0.35)
      + (Math.min(3, Math.max(0, numberValue(strategy.profitFactor))) / 3 * 35)
      + (numberValue(strategy.expectancy) > 0 ? 30 : 0),
    )
    const pnlAlignment = backtestPnl === 0
      ? 'neutral'
      : Math.sign(numberValue(strategy.netRealizedPnl)) === Math.sign(backtestPnl)
        ? 'aligned'
        : 'divergent'
    const riskContribution = strategy.profitFactor > 0 && strategy.profitFactor < 1
      ? 70
      : pnlAlignment === 'divergent'
        ? 60
        : Math.max(0, 100 - qualityScore)

    return {
      strategy: strategy.strategy,
      symbols: strategy.symbols ?? [],
      trades: numberValue(strategy.trades),
      qualityScore: round(qualityScore),
      pnlAlignment,
      riskContribution: round(riskContribution),
    }
  })
  const averageRiskContribution = strategies.length
    ? round(strategies.reduce((sum, strategy) => sum + strategy.riskContribution, 0) / strategies.length)
    : 0
  const dominantStrategy = [...strategies].sort((left, right) => right.riskContribution - left.riskContribution)[0] ?? null

  return {
    strategyCount: strategies.length,
    averageRiskContribution,
    dominantStrategy,
    strategies,
    status: classifyExposure(averageRiskContribution, { caution: 45, elevated: 65 }),
  }
}

function buildFactorConcentrationSummary(factors = {}) {
  const factorScores = [
    { factor: 'market_beta', score: factors.marketBetaExposure.exposureScore, status: factors.marketBetaExposure.status },
    { factor: 'momentum', score: factors.momentumFactorExposure.exposureScore, status: factors.momentumFactorExposure.status },
    { factor: 'volatility', score: factors.volatilityFactorExposure.exposureScore, status: factors.volatilityFactorExposure.status },
    { factor: 'sector', score: factors.sectorFactorExposure.concentrationScore, status: factors.sectorFactorExposure.status },
    { factor: 'asset_class', score: factors.assetClassFactorExposure.concentrationScore, status: factors.assetClassFactorExposure.status },
    { factor: 'strategy', score: factors.strategyFactorExposure.averageRiskContribution, status: factors.strategyFactorExposure.status },
  ]
  const elevatedFactors = factorScores.filter((factor) => factor.status === 'elevated')
  const cautionFactors = factorScores.filter((factor) => factor.status === 'caution')
  const dominantFactor = [...factorScores].sort((left, right) => right.score - left.score)[0]

  return {
    dominantFactor,
    elevatedFactors,
    cautionFactors,
    averageFactorScore: round(factorScores.reduce((sum, factor) => sum + factor.score, 0) / factorScores.length),
    factorScores,
  }
}

function resolveFactorRiskStatus(factorConcentrationSummary = {}) {
  if (factorConcentrationSummary.elevatedFactors.length >= 2 || factorConcentrationSummary.dominantFactor.score >= 78) return 'elevated'
  if (factorConcentrationSummary.elevatedFactors.length === 1 || factorConcentrationSummary.cautionFactors.length >= 2 || factorConcentrationSummary.averageFactorScore >= 55) return 'caution'
  return 'clear'
}

export function evaluatePortfolioFactorExposure(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const portfolioAnalytics = getPortfolioAnalytics(input)
  const portfolioCorrelation = getPortfolioCorrelation(input)
  const strategyAttribution = getStrategyAttribution(input)
  const marketRegime = getMarketRegime(input)
  const backtestPerformance = getBacktestPerformance(input)
  const factorMetadata = buildFactorMetadata(input)
  const symbolExposures = getSymbolExposures(portfolioAnalytics, factorMetadata)
  const marketBetaExposure = summarizeMarketBetaExposure(symbolExposures, marketRegime)
  const momentumFactorExposure = summarizeMomentumFactorExposure(symbolExposures, marketRegime)
  const volatilityFactorExposure = summarizeVolatilityFactorExposure(symbolExposures, marketRegime)
  const sectorFactorExposure = summarizeSectorFactorExposure(portfolioAnalytics, portfolioCorrelation)
  const assetClassFactorExposure = summarizeAssetClassFactorExposure(portfolioAnalytics)
  const strategyFactorExposure = summarizeStrategyFactorExposure(strategyAttribution, backtestPerformance)
  const factorConcentrationSummary = buildFactorConcentrationSummary({
    marketBetaExposure,
    momentumFactorExposure,
    volatilityFactorExposure,
    sectorFactorExposure,
    assetClassFactorExposure,
    strategyFactorExposure,
  })
  const factorRiskStatus = resolveFactorRiskStatus(factorConcentrationSummary)
  const result = {
    eventType: PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    marketBetaExposure,
    momentumFactorExposure,
    volatilityFactorExposure,
    sectorFactorExposure,
    assetClassFactorExposure,
    strategyFactorExposure,
    factorConcentrationSummary,
    factorRiskStatus,
    summary: `Portfolio factor exposure ${factorRiskStatus}: dominant factor is ${factorConcentrationSummary.dominantFactor.factor} with ${round(factorConcentrationSummary.dominantFactor.score)} score.`,
    sourceEvents: {
      portfolioAnalytics: portfolioAnalytics.eventType ?? null,
      portfolioCorrelation: portfolioCorrelation.eventType ?? null,
      strategyAttribution: strategyAttribution.eventType ?? null,
      marketRegime: marketRegime.eventType ?? null,
      strategyBacktestPerformance: backtestPerformance.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_FACTOR_EXPOSURE_EVALUATED_EVENT, result)
  }

  return result
}

export function createPortfolioFactorExposureEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluatePortfolioFactorExposure(input, { ...options, ...evaluationOptions })
    },
  }
}
