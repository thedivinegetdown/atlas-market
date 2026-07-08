import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_CORRELATION_EVALUATED_EVENT = 'portfolio.correlation.evaluated'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 4) {
  return Number(numberValue(value).toFixed(decimals))
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

function getStrategyAttribution(input = {}) {
  return input.strategyAttribution ?? input.attribution ?? {}
}

function getBacktestPerformance(input = {}) {
  return input.strategyBacktestPerformance ?? input.backtestPerformance ?? {}
}

function getHistoricalReplay(input = {}) {
  return input.historicalReplay ?? input.marketReplay ?? {}
}

function getPortfolioSymbols(portfolioAnalytics = {}) {
  return (portfolioAnalytics.exposure?.bySymbol ?? []).map((item) => ({
    symbol: normalizeSymbol(item.symbol),
    assetType: item.assetType ?? 'unknown',
    sector: item.sector ?? 'Unclassified',
    weight: numberValue(item.weight),
    marketValue: numberValue(item.absoluteMarketValue ?? item.marketValue),
  })).filter((item) => item.symbol)
}

function normalizeCandleSeries(candles = []) {
  return [...candles]
    .filter((candle) => candle?.symbol && Number.isFinite(Number(candle.close)))
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .map((candle) => ({
      symbol: normalizeSymbol(candle.symbol),
      timestamp: candle.timestamp,
      close: numberValue(candle.close),
    }))
}

function buildHistoricalSeries(input = {}, portfolioSymbols = []) {
  const replay = getHistoricalReplay(input)
  const series = new Map()
  const addCandles = (symbol, candles = []) => {
    const normalizedSymbol = normalizeSymbol(symbol)
    if (!normalizedSymbol) return
    const normalizedCandles = normalizeCandleSeries(candles.map((candle) => ({ ...candle, symbol: candle.symbol ?? normalizedSymbol })))
    if (normalizedCandles.length > 0) series.set(normalizedSymbol, normalizedCandles)
  }

  for (const [symbol, candles] of Object.entries(input.historicalPriceSeries ?? input.marketPriceSeries ?? {})) {
    addCandles(symbol, Array.isArray(candles) ? candles : [])
  }

  for (const item of input.historicalCandlesBySymbol ?? []) {
    addCandles(item.symbol, item.candles ?? [])
  }

  for (const candle of replay.normalizedHistoricalCandles ?? []) {
    const symbol = normalizeSymbol(candle.symbol)
    const current = series.get(symbol) ?? []
    current.push(candle)
    series.set(symbol, normalizeCandleSeries(current))
  }

  for (const symbol of portfolioSymbols) {
    if (!series.has(symbol.symbol)) series.set(symbol.symbol, [])
  }

  return series
}

function calculateReturns(candles = []) {
  const returns = []
  for (let index = 1; index < candles.length; index += 1) {
    const previous = numberValue(candles[index - 1].close)
    const current = numberValue(candles[index].close)
    if (previous !== 0) returns.push(round((current - previous) / previous, 6))
  }
  return returns
}

function pearsonCorrelation(left = [], right = []) {
  const length = Math.min(left.length, right.length)
  if (length < 2) return null
  const leftValues = left.slice(-length)
  const rightValues = right.slice(-length)
  const leftMean = leftValues.reduce((sum, value) => sum + value, 0) / length
  const rightMean = rightValues.reduce((sum, value) => sum + value, 0) / length
  let numerator = 0
  let leftVariance = 0
  let rightVariance = 0

  for (let index = 0; index < length; index += 1) {
    const leftDelta = leftValues[index] - leftMean
    const rightDelta = rightValues[index] - rightMean
    numerator += leftDelta * rightDelta
    leftVariance += leftDelta ** 2
    rightVariance += rightDelta ** 2
  }

  const denominator = Math.sqrt(leftVariance * rightVariance)
  if (denominator === 0) return null
  return round(numerator / denominator, 4)
}

function buildAssetCorrelationMatrix({ portfolioSymbols, historicalSeries }) {
  const returnsBySymbol = new Map()
  portfolioSymbols.forEach((item) => {
    returnsBySymbol.set(item.symbol, calculateReturns(historicalSeries.get(item.symbol) ?? []))
  })

  return portfolioSymbols.map((row) => ({
    symbol: row.symbol,
    assetType: row.assetType,
    sector: row.sector,
    weight: round(row.weight, 2),
    correlations: portfolioSymbols.map((column) => ({
      symbol: column.symbol,
      correlation: row.symbol === column.symbol
        ? 1
        : pearsonCorrelation(returnsBySymbol.get(row.symbol), returnsBySymbol.get(column.symbol)),
      observations: row.symbol === column.symbol
        ? returnsBySymbol.get(row.symbol)?.length ?? 0
        : Math.min(returnsBySymbol.get(row.symbol)?.length ?? 0, returnsBySymbol.get(column.symbol)?.length ?? 0),
    })),
  }))
}

function flattenPairs(matrix = []) {
  const pairs = []
  matrix.forEach((row, rowIndex) => {
    row.correlations.forEach((item, columnIndex) => {
      if (columnIndex <= rowIndex || item.correlation === null) return
      pairs.push({
        left: row.symbol,
        right: item.symbol,
        correlation: item.correlation,
        observations: item.observations,
      })
    })
  })
  return pairs
}

function summarizeStrategyCorrelation(strategyAttribution = {}, backtestPerformance = {}) {
  const strategies = strategyAttribution.strategies ?? []
  const backtestMetrics = backtestPerformance.metrics ?? {}
  const summaries = strategies.map((strategy) => {
    const pnlAlignment = numberValue(backtestMetrics.netRealizedPnl) === 0
      ? 'neutral'
      : Math.sign(numberValue(strategy.netRealizedPnl)) === Math.sign(numberValue(backtestMetrics.netRealizedPnl))
        ? 'aligned'
        : 'divergent'
    const qualityScore = Math.max(0, Math.min(100,
      (numberValue(strategy.winRate) * 0.35)
      + (Math.min(3, Math.max(0, numberValue(strategy.profitFactor))) / 3 * 35)
      + (numberValue(strategy.expectancy) > 0 ? 30 : 0),
    ))

    return {
      strategy: strategy.strategy,
      symbols: strategy.symbols ?? [],
      trades: numberValue(strategy.trades),
      netRealizedPnl: round(strategy.netRealizedPnl, 2),
      profitFactor: round(strategy.profitFactor, 2),
      pnlAlignment,
      qualityScore: round(qualityScore, 2),
    }
  })
  const alignedStrategies = summaries.filter((strategy) => strategy.pnlAlignment === 'aligned').length
  const divergentStrategies = summaries.filter((strategy) => strategy.pnlAlignment === 'divergent').length

  return {
    strategyCount: summaries.length,
    alignedStrategies,
    divergentStrategies,
    averageQualityScore: summaries.length
      ? round(summaries.reduce((sum, strategy) => sum + strategy.qualityScore, 0) / summaries.length, 2)
      : 0,
    strategies: summaries,
  }
}

function summarizeSectorCorrelation(portfolioAnalytics = {}, matrix = []) {
  const sectorExposure = portfolioAnalytics.exposure?.bySector ?? []
  const symbolsBySector = new Map()
  matrix.forEach((row) => {
    const current = symbolsBySector.get(row.sector) ?? []
    current.push(row.symbol)
    symbolsBySector.set(row.sector, current)
  })
  const pairs = flattenPairs(matrix)

  return sectorExposure.map((sector) => {
    const symbols = symbolsBySector.get(sector.name) ?? []
    const internalPairs = pairs.filter((pair) => symbols.includes(pair.left) && symbols.includes(pair.right))
    const averageInternalCorrelation = internalPairs.length
      ? round(internalPairs.reduce((sum, pair) => sum + Math.abs(pair.correlation), 0) / internalPairs.length, 4)
      : symbols.length <= 1 ? 0 : null

    return {
      sector: sector.name,
      weight: round(sector.weight, 2),
      symbolCount: symbols.length,
      averageInternalCorrelation,
      correlated: averageInternalCorrelation !== null && averageInternalCorrelation >= 0.7,
    }
  })
}

function evaluateConcentrationRisk({ portfolioAnalytics, matrix }) {
  const largestPosition = portfolioAnalytics.concentration?.largestPosition ?? null
  const pairs = flattenPairs(matrix)
  const highCorrelationPairs = pairs.filter((pair) => Math.abs(pair.correlation) >= 0.7)
  const correlatedSymbols = new Set(highCorrelationPairs.flatMap((pair) => [pair.left, pair.right]))
  const symbolExposure = portfolioAnalytics.exposure?.bySymbol ?? []
  const correlatedWeight = symbolExposure
    .filter((item) => correlatedSymbols.has(normalizeSymbol(item.symbol)))
    .reduce((sum, item) => sum + numberValue(item.weight), 0)
  const largestWeight = numberValue(largestPosition?.weight)
  const concentrationScore = round(Math.min(100, (correlatedWeight * 0.7) + (largestWeight * 0.3)), 2)

  return {
    largestPosition: largestPosition ? {
      symbol: largestPosition.symbol,
      weight: round(largestPosition.weight, 2),
      sector: largestPosition.sector ?? 'Unclassified',
    } : null,
    highCorrelationPairs,
    correlatedSymbolCount: correlatedSymbols.size,
    correlatedWeight: round(correlatedWeight, 2),
    concentrationScore,
  }
}

function summarizeDiversificationImpact({ portfolioAnalytics, concentrationRisk, matrix }) {
  const diversification = portfolioAnalytics.diversification ?? {}
  const pairs = flattenPairs(matrix)
  const averagePairCorrelation = pairs.length
    ? round(pairs.reduce((sum, pair) => sum + Math.abs(pair.correlation), 0) / pairs.length, 4)
    : 0
  const impactScore = round(Math.max(0, Math.min(100,
    numberValue(diversification.score)
    - (concentrationRisk.correlatedWeight * 0.35)
    - (averagePairCorrelation * 20),
  )), 2)

  return {
    baseDiversificationScore: round(diversification.score, 2),
    diversificationLabel: diversification.label ?? 'unknown',
    averagePairCorrelation,
    correlationAdjustedDiversificationScore: impactScore,
    impact: impactScore >= 70 ? 'positive' : impactScore >= 50 ? 'mixed' : 'constrained',
  }
}

function resolveRiskStatus({ concentrationRisk, diversificationImpact, matrix }) {
  const pairs = flattenPairs(matrix)
  const highPairs = pairs.filter((pair) => Math.abs(pair.correlation) >= 0.8).length
  if (concentrationRisk.correlatedWeight >= 45 || diversificationImpact.correlationAdjustedDiversificationScore < 45 || highPairs >= 3) return 'elevated'
  if (concentrationRisk.correlatedWeight >= 25 || diversificationImpact.correlationAdjustedDiversificationScore < 65 || highPairs > 0) return 'caution'
  return 'clear'
}

export function evaluatePortfolioCorrelation(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const portfolioAnalytics = getPortfolioAnalytics(input)
  const strategyAttribution = getStrategyAttribution(input)
  const backtestPerformance = getBacktestPerformance(input)
  const historicalReplay = getHistoricalReplay(input)
  const portfolioSymbols = getPortfolioSymbols(portfolioAnalytics)
  const historicalSeries = buildHistoricalSeries(input, portfolioSymbols)
  const assetCorrelationMatrix = buildAssetCorrelationMatrix({ portfolioSymbols, historicalSeries })
  const strategyCorrelationSummary = summarizeStrategyCorrelation(strategyAttribution, backtestPerformance)
  const sectorCorrelationSummary = summarizeSectorCorrelation(portfolioAnalytics, assetCorrelationMatrix)
  const concentrationRiskFromCorrelatedAssets = evaluateConcentrationRisk({ portfolioAnalytics, matrix: assetCorrelationMatrix })
  const diversificationImpactSummary = summarizeDiversificationImpact({
    portfolioAnalytics,
    concentrationRisk: concentrationRiskFromCorrelatedAssets,
    matrix: assetCorrelationMatrix,
  })
  const correlationRiskStatus = resolveRiskStatus({
    concentrationRisk: concentrationRiskFromCorrelatedAssets,
    diversificationImpact: diversificationImpactSummary,
    matrix: assetCorrelationMatrix,
  })
  const result = {
    eventType: PORTFOLIO_CORRELATION_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    assetCorrelationMatrix,
    strategyCorrelationSummary,
    sectorCorrelationSummary,
    concentrationRiskFromCorrelatedAssets,
    diversificationImpactSummary,
    correlationRiskStatus,
    summary: `Portfolio correlation risk ${correlationRiskStatus}: ${concentrationRiskFromCorrelatedAssets.correlatedSymbolCount} correlated symbols, ${diversificationImpactSummary.impact} diversification impact.`,
    sourceEvents: {
      portfolioAnalytics: portfolioAnalytics.eventType ?? null,
      strategyAttribution: strategyAttribution.eventType ?? null,
      strategyBacktestPerformance: backtestPerformance.eventType ?? null,
      historicalReplay: historicalReplay.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_CORRELATION_EVALUATED_EVENT, result)
  }

  return result
}

export function createPortfolioCorrelationEngine(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluatePortfolioCorrelation(input, { ...options, ...evaluationOptions })
    },
  }
}
