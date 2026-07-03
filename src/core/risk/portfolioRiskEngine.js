import { getAssetProfile, normalizeAssetType } from '../../../lib/assets/index.js'
import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_RISK_EVALUATED_EVENT = 'portfolio.risk.evaluated'

const defaultLimits = Object.freeze({
  maxPositionWeight: 25,
  maxAssetClassWeight: 65,
  maxGrossExposure: 125,
  maxNetExposure: 100,
  maxLeverage: 1.25,
  maxPortfolioVar: 3,
  maxOpenRisk: 2.5,
  maxDrawdown: 12,
})

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, numberValue(value)))
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function getPositionMarketValue(position, profile) {
  const explicitMarketValue = Number(position.marketValue)
  if (Number.isFinite(explicitMarketValue)) return explicitMarketValue

  return numberValue(position.quantity) * numberValue(position.currentPrice) * numberValue(profile.contractMultiplier, 1)
}

function normalizePosition(position = {}, portfolioEquity = 0) {
  const assetType = normalizeAssetType(position.assetType)
  const profile = getAssetProfile(assetType)
  const side = String(position.side ?? 'long').toLowerCase() === 'short' ? 'short' : 'long'
  const marketValue = getPositionMarketValue(position, profile)
  const signedMarketValue = side === 'short' ? -Math.abs(marketValue) : Math.abs(marketValue)
  const absoluteMarketValue = Math.abs(signedMarketValue)
  const weight = portfolioEquity > 0 ? (absoluteMarketValue / portfolioEquity) * 100 : 0
  const volatility = numberValue(position.volatility, 0)
  const beta = numberValue(position.beta, assetType === 'equity' || assetType === 'etf' ? 1 : 0)
  const stopPrice = Number(position.stopPrice)
  const currentPrice = numberValue(position.currentPrice)
  const stopDistance = Number.isFinite(stopPrice) && currentPrice > 0
    ? Math.abs(currentPrice - stopPrice) / currentPrice
    : numberValue(position.riskPct, 0) / 100
  const dollarRisk = numberValue(position.dollarRisk, absoluteMarketValue * stopDistance)

  return {
    symbol: String(position.symbol ?? '').trim().toUpperCase(),
    assetType,
    side,
    quantity: numberValue(position.quantity),
    quantityLabel: profile.quantityTerm,
    averagePrice: numberValue(position.averagePrice ?? position.entryPrice),
    currentPrice,
    marketValue: round(signedMarketValue),
    absoluteMarketValue: round(absoluteMarketValue),
    unrealizedPnl: round(numberValue(position.unrealizedPnl)),
    volatility,
    beta,
    liquidityScore: clamp(position.liquidityScore ?? 70),
    dollarRisk: round(dollarRisk),
    weight: round(weight),
    marginRequirement: round(absoluteMarketValue * numberValue(profile.margin?.initialRequirement, 1)),
  }
}

function summarizeAssetExposure(positions, equity) {
  const exposure = new Map()

  for (const position of positions) {
    const current = exposure.get(position.assetType) ?? {
      assetType: position.assetType,
      marketValue: 0,
      weight: 0,
      count: 0,
    }
    current.marketValue += position.absoluteMarketValue
    current.weight = equity > 0 ? (current.marketValue / equity) * 100 : 0
    current.count += 1
    exposure.set(position.assetType, current)
  }

  return Array.from(exposure.values())
    .map((entry) => ({
      ...entry,
      marketValue: round(entry.marketValue),
      weight: round(entry.weight),
    }))
    .sort((left, right) => right.weight - left.weight)
}

function buildWarnings({ positions, assetExposure, grossExposure, netExposure, leverage, portfolioVar, openRiskPct, drawdownPct, limits }) {
  const warnings = []
  const largestPosition = positions[0]
  const largestAssetClass = assetExposure[0]

  if (largestPosition?.weight > limits.maxPositionWeight) {
    warnings.push(`${largestPosition.symbol} exceeds max position weight`)
  }
  if (largestAssetClass?.weight > limits.maxAssetClassWeight) {
    warnings.push(`${largestAssetClass.assetType} exposure exceeds asset-class limit`)
  }
  if (grossExposure > limits.maxGrossExposure) warnings.push('Gross exposure exceeds portfolio limit')
  if (Math.abs(netExposure) > limits.maxNetExposure) warnings.push('Net exposure exceeds portfolio limit')
  if (leverage > limits.maxLeverage) warnings.push('Portfolio leverage exceeds paper-trading limit')
  if (portfolioVar > limits.maxPortfolioVar) warnings.push('Estimated portfolio VaR is elevated')
  if (openRiskPct > limits.maxOpenRisk) warnings.push('Open risk exceeds configured limit')
  if (drawdownPct > limits.maxDrawdown) warnings.push('Drawdown exceeds configured limit')

  return warnings
}

function scoreRisk({ concentrationRisk, grossExposure, leverage, portfolioVar, openRiskPct, drawdownPct, warnings, limits }) {
  const penalties = [
    concentrationRisk * 0.65,
    Math.max(0, grossExposure - 100) * 0.35,
    Math.max(0, (leverage - 1) * 35),
    (portfolioVar / limits.maxPortfolioVar) * 18,
    (openRiskPct / limits.maxOpenRisk) * 18,
    (drawdownPct / limits.maxDrawdown) * 12,
    warnings.length * 7,
  ]
  return round(clamp(penalties.reduce((sum, value) => sum + value, 0)))
}

function classifyRisk(score) {
  if (score >= 75) return 'critical'
  if (score >= 55) return 'high'
  if (score >= 32) return 'elevated'
  return 'controlled'
}

function buildRecommendations({ riskLevel, warnings, positions }) {
  if (riskLevel === 'critical') {
    return ['Cut concentration first', 'Reduce gross exposure before adding risk', 'Pause new paper trades until exposure normalizes']
  }
  if (riskLevel === 'high') {
    return ['Review position sizing', 'Tighten stops on concentrated positions', 'Avoid correlated additions']
  }
  if (warnings.length > 0) {
    return ['Monitor flagged limits', 'Keep new entries smaller than current portfolio average risk']
  }
  if (positions.length === 0) {
    return ['Portfolio has no open positions', 'Keep paper mode enabled before testing new allocations']
  }
  return ['Risk posture is acceptable', 'Maintain paper-trading discipline and continue monitoring exposure']
}

export function evaluatePortfolioRisk(portfolio = {}, options = {}) {
  const limits = { ...defaultLimits, ...(options.limits ?? {}) }
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const equity = numberValue(portfolio.accountValue ?? portfolio.equity ?? portfolio.cash, 0)
  const cash = numberValue(portfolio.cash)
  const positions = (portfolio.positions ?? [])
    .map((position) => normalizePosition(position, equity))
    .filter((position) => position.symbol && position.quantity !== 0)
    .sort((left, right) => right.weight - left.weight)
  const grossMarketValue = positions.reduce((sum, position) => sum + position.absoluteMarketValue, 0)
  const netMarketValue = positions.reduce((sum, position) => sum + position.marketValue, 0)
  const grossExposure = equity > 0 ? (grossMarketValue / equity) * 100 : 0
  const netExposure = equity > 0 ? (netMarketValue / equity) * 100 : 0
  const leverage = equity > 0 ? grossMarketValue / equity : 0
  const openRisk = positions.reduce((sum, position) => sum + position.dollarRisk, 0)
  const openRiskPct = equity > 0 ? (openRisk / equity) * 100 : 0
  const concentrationRisk = positions[0]?.weight ?? 0
  const weightedVolatility = grossMarketValue > 0
    ? positions.reduce((sum, position) => sum + (position.volatility * (position.absoluteMarketValue / grossMarketValue)), 0)
    : 0
  const weightedLiquidityScore = grossMarketValue > 0
    ? positions.reduce((sum, position) => sum + (position.liquidityScore * (position.absoluteMarketValue / grossMarketValue)), 0)
    : 100
  const portfolioBeta = grossMarketValue > 0
    ? positions.reduce((sum, position) => sum + (position.beta * (position.absoluteMarketValue / grossMarketValue)), 0)
    : 0
  const drawdownPct = numberValue(portfolio.drawdownPct)
  const portfolioVar = round((weightedVolatility * Math.max(0.25, leverage)) / 1.65)
  const assetExposure = summarizeAssetExposure(positions, equity)
  const warnings = buildWarnings({
    positions,
    assetExposure,
    grossExposure,
    netExposure,
    leverage,
    portfolioVar,
    openRiskPct,
    drawdownPct,
    limits,
  })
  const riskScore = scoreRisk({
    concentrationRisk,
    grossExposure,
    leverage,
    portfolioVar,
    openRiskPct,
    drawdownPct,
    warnings,
    limits,
  })
  const riskLevel = classifyRisk(riskScore)
  const result = {
    eventType: PORTFOLIO_RISK_EVALUATED_EVENT,
    paperTrading: true,
    portfolioId: portfolio.id ?? 'paper-portfolio',
    timestamp,
    account: {
      accountValue: round(equity),
      cash: round(cash),
      buyingPower: round(numberValue(portfolio.buyingPower, cash)),
    },
    summary: {
      riskScore,
      riskLevel,
      grossExposure: round(grossExposure),
      netExposure: round(netExposure),
      leverage: round(leverage),
      openRisk: round(openRisk),
      openRiskPct: round(openRiskPct),
      concentrationRisk: round(concentrationRisk),
      portfolioVar,
      weightedVolatility: round(weightedVolatility),
      weightedLiquidityScore: round(weightedLiquidityScore),
      portfolioBeta: round(portfolioBeta),
      drawdownPct: round(drawdownPct),
    },
    assetExposure,
    positions,
    warnings,
    recommendations: buildRecommendations({ riskLevel, warnings, positions }),
    limits,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_RISK_EVALUATED_EVENT, result)
  }

  return result
}

export function createPortfolioRiskEngine(options = {}) {
  return {
    evaluate(portfolio, evaluationOptions = {}) {
      return evaluatePortfolioRisk(portfolio, { ...options, ...evaluationOptions })
    },
  }
}
