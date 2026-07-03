import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePortfolioRisk } from '../risk/portfolioRiskEngine.js'

export const PORTFOLIO_ANALYTICS_UPDATED_EVENT = 'portfolio.analytics.updated'

const defaultTargets = Object.freeze({
  assetClass: Object.freeze({
    etf: 45,
    equity: 25,
    crypto: 10,
    forex: 10,
    futures: 10,
  }),
  maxAssetDriftPct: 10,
  maxSectorDriftPct: 12,
})

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function normalizePortfolioInput(input = {}) {
  if (input.account && Array.isArray(input.positions)) {
    return {
      id: input.portfolioId ?? 'paper-portfolio',
      accountValue: numberValue(input.account.equity ?? input.account.accountValue ?? input.account.cash),
      cash: numberValue(input.account.cash),
      buyingPower: numberValue(input.account.buyingPower ?? input.account.cash),
      positions: input.positions,
    }
  }

  return {
    ...input,
    accountValue: numberValue(input.accountValue ?? input.equity ?? input.cash),
    cash: numberValue(input.cash),
    buyingPower: numberValue(input.buyingPower ?? input.cash),
    positions: Array.isArray(input.positions) ? input.positions : [],
  }
}

function buildPositionMetadataMap(positions = []) {
  return new Map(positions.map((position) => [
    `${normalizeSymbol(position.symbol)}:${String(position.assetType ?? '').toLowerCase()}:${String(position.side ?? 'long').toLowerCase()}`,
    position,
  ]))
}

function getPositionMetadata(position, metadataMap) {
  return metadataMap.get(`${normalizeSymbol(position.symbol)}:${position.assetType}:${position.side}`) ?? {}
}

function aggregateExposure(items, keyName) {
  const total = items.reduce((sum, item) => sum + numberValue(item.absoluteMarketValue), 0)
  const exposure = new Map()

  for (const item of items) {
    const key = item[keyName] || 'Unclassified'
    const current = exposure.get(key) ?? { name: key, marketValue: 0, count: 0 }
    current.marketValue += numberValue(item.absoluteMarketValue)
    current.count += 1
    exposure.set(key, current)
  }

  return Array.from(exposure.values())
    .map((item) => ({
      ...item,
      marketValue: round(item.marketValue),
      weight: total > 0 ? round((item.marketValue / total) * 100) : 0,
    }))
    .sort((left, right) => right.weight - left.weight)
}

function calculateDiversificationScore(symbolExposure, sectorExposure, assetClassExposure) {
  if (symbolExposure.length === 0) return 0
  const hhi = symbolExposure.reduce((sum, item) => sum + ((numberValue(item.weight) / 100) ** 2), 0)
  const concentrationPenalty = Math.min(60, hhi * 100)
  const breadthBonus = Math.min(25, symbolExposure.length * 4)
  const sectorBonus = Math.min(10, sectorExposure.length * 3)
  const assetBonus = Math.min(10, assetClassExposure.length * 2)

  return round(Math.max(0, Math.min(100, 100 - concentrationPenalty + breadthBonus + sectorBonus + assetBonus)))
}

function detectDrift(assetClassExposure, sectorExposure, targets) {
  const drift = []
  const assetTargets = targets.assetClass ?? {}

  for (const exposure of assetClassExposure) {
    const target = numberValue(assetTargets[exposure.assetType], 0)
    const driftPct = round(exposure.weight - target)
    if (Math.abs(driftPct) > numberValue(targets.maxAssetDriftPct, 10)) {
      drift.push({
        scope: 'asset_class',
        name: exposure.assetType,
        actual: exposure.weight,
        target,
        driftPct,
      })
    }
  }

  for (const exposure of sectorExposure) {
    if (exposure.weight > numberValue(targets.maxSectorDriftPct, 12)) {
      drift.push({
        scope: 'sector',
        name: exposure.name,
        actual: exposure.weight,
        target: numberValue(targets.maxSectorDriftPct, 12),
        driftPct: round(exposure.weight - numberValue(targets.maxSectorDriftPct, 12)),
      })
    }
  }

  return drift.sort((left, right) => Math.abs(right.driftPct) - Math.abs(left.driftPct))
}

function buildInsights({ diversificationScore, drift, concentration }) {
  const insights = []
  if (diversificationScore >= 75) insights.push('Diversification is institutionally balanced')
  if (diversificationScore < 55) insights.push('Portfolio diversification is constrained by concentration')
  if (concentration?.weight > 25) insights.push(`${concentration.symbol} is the dominant concentration risk`)
  if (drift.length > 0) insights.push('Portfolio drift requires review against target allocations')
  if (insights.length === 0) insights.push('Portfolio composition is stable')
  return insights
}

export function evaluatePortfolioAnalytics(portfolioInput = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const targets = { ...defaultTargets, ...(options.targets ?? {}) }
  const portfolio = normalizePortfolioInput(portfolioInput)
  const risk = options.riskSnapshot ?? evaluatePortfolioRisk(portfolio, { emitEvent: false, limits: options.riskLimits })
  const metadataMap = buildPositionMetadataMap(portfolio.positions)
  const enrichedPositions = risk.positions.map((position) => {
    const metadata = getPositionMetadata(position, metadataMap)
    return {
      ...position,
      sector: metadata.sector ?? metadata.category ?? 'Unclassified',
    }
  })
  const assetClassExposure = risk.assetExposure.map((item) => ({
    assetType: item.assetType,
    marketValue: item.marketValue,
    weight: item.weight,
    count: item.count,
  }))
  const sectorExposure = aggregateExposure(enrichedPositions, 'sector')
  const symbolExposure = enrichedPositions.map((position) => ({
    symbol: position.symbol,
    assetType: position.assetType,
    sector: position.sector,
    side: position.side,
    marketValue: position.marketValue,
    absoluteMarketValue: position.absoluteMarketValue,
    weight: position.weight,
  })).sort((left, right) => right.weight - left.weight)
  const longMarketValue = enrichedPositions
    .filter((position) => position.side === 'long')
    .reduce((sum, position) => sum + numberValue(position.absoluteMarketValue), 0)
  const shortMarketValue = enrichedPositions
    .filter((position) => position.side === 'short')
    .reduce((sum, position) => sum + numberValue(position.absoluteMarketValue), 0)
  const grossMarketValue = longMarketValue + shortMarketValue
  const concentration = symbolExposure[0] ?? null
  const diversificationScore = calculateDiversificationScore(symbolExposure, sectorExposure, assetClassExposure)
  const drift = detectDrift(assetClassExposure, sectorExposure, targets)
  const result = {
    eventType: PORTFOLIO_ANALYTICS_UPDATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'updated',
    portfolioId: portfolio.id ?? risk.portfolioId ?? 'paper-portfolio',
    account: risk.account,
    exposure: {
      byAssetClass: assetClassExposure,
      bySector: sectorExposure,
      bySymbol: symbolExposure,
      longMarketValue: round(longMarketValue),
      shortMarketValue: round(shortMarketValue),
      longExposure: grossMarketValue > 0 ? round((longMarketValue / grossMarketValue) * 100) : 0,
      shortExposure: grossMarketValue > 0 ? round((shortMarketValue / grossMarketValue) * 100) : 0,
      grossExposure: risk.summary.grossExposure,
      netExposure: risk.summary.netExposure,
      leverage: risk.summary.leverage,
    },
    concentration: {
      largestPosition: concentration,
      concentrationRisk: risk.summary.concentrationRisk,
      topHoldings: symbolExposure.slice(0, 5),
    },
    diversification: {
      score: diversificationScore,
      label: diversificationScore >= 75 ? 'strong' : diversificationScore >= 55 ? 'moderate' : 'concentrated',
      assetClassCount: assetClassExposure.length,
      sectorCount: sectorExposure.length,
      symbolCount: symbolExposure.length,
    },
    drift: {
      hasDrift: drift.length > 0,
      items: drift,
    },
    insights: buildInsights({ diversificationScore, drift, concentration }),
    riskSnapshot: risk.summary,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_ANALYTICS_UPDATED_EVENT, result)
  }

  return result
}

export function createPortfolioAnalyticsEngine(options = {}) {
  return {
    evaluate(portfolio, analyticsOptions = {}) {
      return evaluatePortfolioAnalytics(portfolio, { ...options, ...analyticsOptions })
    },
  }
}
