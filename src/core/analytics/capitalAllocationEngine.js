import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePortfolioRisk } from '../risk/portfolioRiskEngine.js'
import { evaluatePortfolioAnalytics } from './portfolioAnalyticsEngine.js'

export const PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT = 'portfolio.capitalAllocation.recommended'

const defaultTargets = Object.freeze({
  reservedCashBufferPct: 10,
  riskBudgetPct: 2.5,
  driftThresholdPct: 5,
  maxSymbolWeightPct: 20,
  assetClass: Object.freeze({
    etf: 40,
    equity: 30,
    crypto: 10,
    forex: 10,
    futures: 10,
    options: 0,
  }),
})

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

function getAccount(analytics) {
  return {
    accountValue: numberValue(analytics.account?.accountValue),
    cash: numberValue(analytics.account?.cash),
    buyingPower: numberValue(analytics.account?.buyingPower, analytics.account?.cash),
  }
}

function classifyDrift(actualWeight, targetWeight, threshold) {
  const driftPct = round(actualWeight - targetWeight)
  if (driftPct > threshold) return { driftPct, allocationState: 'overweight' }
  if (driftPct < -threshold) return { driftPct, allocationState: 'underweight' }
  return { driftPct, allocationState: 'balanced' }
}

function buildAssetClassAllocation({ analytics, accountValue, targets, availableCapital }) {
  const actualByAsset = new Map((analytics.exposure?.byAssetClass ?? [])
    .map((item) => [item.assetType, item]))
  const assetTypes = [...new Set([
    ...Object.keys(targets.assetClass ?? {}),
    ...actualByAsset.keys(),
  ])]

  return assetTypes.map((assetType) => {
    const actual = actualByAsset.get(assetType) ?? { marketValue: 0, weight: 0, count: 0 }
    const targetWeight = numberValue(targets.assetClass?.[assetType])
    const targetCapital = accountValue * (targetWeight / 100)
    const currentCapital = numberValue(actual.marketValue)
    const deltaCapital = targetCapital - currentCapital
    const drift = classifyDrift(numberValue(actual.weight), targetWeight, targets.driftThresholdPct)

    return {
      assetType,
      currentCapital: round(currentCapital),
      targetCapital: round(targetCapital),
      recommendedCapital: round(Math.min(Math.max(0, deltaCapital), availableCapital)),
      currentWeight: round(numberValue(actual.weight)),
      targetWeight: round(targetWeight),
      count: numberValue(actual.count),
      ...drift,
    }
  }).sort((left, right) => Math.abs(right.driftPct) - Math.abs(left.driftPct))
}

function buildSymbolAllocation({ analytics, accountValue, maxSymbolWeightPct, driftThresholdPct }) {
  return (analytics.exposure?.bySymbol ?? []).map((symbol) => {
    const currentWeight = numberValue(symbol.weight)
    const currentCapital = numberValue(symbol.absoluteMarketValue)
    const maxCapital = accountValue * (maxSymbolWeightPct / 100)
    const drift = classifyDrift(currentWeight, maxSymbolWeightPct, driftThresholdPct)

    return {
      symbol: symbol.symbol,
      assetType: symbol.assetType,
      sector: symbol.sector,
      side: symbol.side,
      currentCapital: round(currentCapital),
      maxCapital: round(maxCapital),
      currentWeight: round(currentWeight),
      targetWeight: round(Math.min(maxSymbolWeightPct, currentWeight)),
      allocationState: currentWeight > maxSymbolWeightPct ? 'overweight' : 'balanced',
      driftPct: currentWeight > maxSymbolWeightPct ? round(currentWeight - maxSymbolWeightPct) : drift.driftPct,
    }
  }).sort((left, right) => Math.abs(right.driftPct) - Math.abs(left.driftPct))
}

function scoreStrategy(strategy) {
  const winRateScore = clamp(strategy.winRate) / 100
  const profitFactorScore = Math.min(2, numberValue(strategy.profitFactor)) / 2
  const expectancyScore = Math.max(0, numberValue(strategy.expectancy)) / Math.max(1, Math.abs(numberValue(strategy.averageLoss, -1)))
  const activityScore = Math.min(1, numberValue(strategy.trades) / 5)
  return round((winRateScore * 35) + (profitFactorScore * 30) + (Math.min(1, expectancyScore) * 25) + (activityScore * 10))
}

function buildStrategyAllocation({ strategyAttribution, availableCapital, remainingRiskBudget }) {
  const strategies = strategyAttribution?.strategies ?? []
  if (strategies.length === 0) return []

  const scored = strategies.map((strategy) => ({
    ...strategy,
    allocationScore: scoreStrategy(strategy),
  }))
  const scoreTotal = scored.reduce((sum, strategy) => sum + Math.max(1, strategy.allocationScore), 0)

  return scored.map((strategy) => {
    const share = Math.max(1, strategy.allocationScore) / scoreTotal
    const allocationState = strategy.netRealizedPnl < 0 || strategy.profitFactor < 1 ? 'underweight' : 'balanced'

    return {
      strategy: strategy.strategy,
      allocationScore: strategy.allocationScore,
      recommendedCapital: round(availableCapital * share),
      riskBudget: round(remainingRiskBudget * share),
      trades: strategy.trades,
      winRate: strategy.winRate,
      profitFactor: strategy.profitFactor,
      expectancy: strategy.expectancy,
      netRealizedPnl: strategy.netRealizedPnl,
      allocationState,
    }
  }).sort((left, right) => right.recommendedCapital - left.recommendedCapital)
}

function deriveAllocationStatus({ availableCapital, drawdownProtection, risk, assetClassAllocation, symbolAllocation }) {
  if (
    availableCapital <= 0
    || drawdownProtection?.protectionStatus === 'locked'
    || risk.summary?.riskLevel === 'critical'
  ) {
    return 'constrained'
  }

  const hasOverweight = assetClassAllocation.some((item) => item.allocationState === 'overweight')
    || symbolAllocation.some((item) => item.allocationState === 'overweight')

  if (
    drawdownProtection?.protectionStatus === 'caution'
    || risk.summary?.riskLevel === 'high'
    || risk.summary?.riskLevel === 'elevated'
    || hasOverweight
  ) {
    return 'caution'
  }

  return 'balanced'
}

function buildRecommendations({ allocationStatus, assetClassAllocation, symbolAllocation, positionSizing }) {
  const recommendations = []
  const overweightAsset = assetClassAllocation.find((item) => item.allocationState === 'overweight')
  const underweightAsset = assetClassAllocation.find((item) => item.allocationState === 'underweight')
  const overweightSymbol = symbolAllocation.find((item) => item.allocationState === 'overweight')

  if (allocationStatus === 'constrained') {
    recommendations.push('Preserve cash and pause new paper capital allocation until constraints clear')
  }
  if (overweightAsset) {
    recommendations.push(`Reduce new allocation to ${overweightAsset.assetType} until drift normalizes`)
  }
  if (underweightAsset && allocationStatus !== 'constrained') {
    recommendations.push(`Prioritize available paper capital toward ${underweightAsset.assetType}`)
  }
  if (overweightSymbol) {
    recommendations.push(`${overweightSymbol.symbol} exceeds symbol allocation cap`)
  }
  if (positionSizing?.status === 'recommended') {
    recommendations.push(`Current sizing candidate uses ${round(positionSizing.metrics?.riskPct)}% risk`)
  }
  if (recommendations.length === 0) {
    recommendations.push('Capital allocation is balanced against configured paper targets')
  }

  return recommendations
}

export function recommendCapitalAllocation(portfolio = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const targets = {
    ...defaultTargets,
    ...(options.targets ?? {}),
    assetClass: {
      ...defaultTargets.assetClass,
      ...(options.targets?.assetClass ?? {}),
    },
  }
  const risk = options.riskSnapshot ?? evaluatePortfolioRisk(portfolio, { emitEvent: false })
  const analytics = options.portfolioAnalytics ?? evaluatePortfolioAnalytics(portfolio, {
    emitEvent: false,
    riskSnapshot: risk,
  })
  const account = getAccount(analytics)
  const reservedCashBuffer = account.accountValue * (targets.reservedCashBufferPct / 100)
  const availableCapital = Math.max(0, Math.min(account.cash, account.buyingPower) - reservedCashBuffer)
  const totalRiskBudget = account.accountValue * (targets.riskBudgetPct / 100)
  const openRisk = numberValue(risk.summary?.openRisk)
  const remainingRiskBudget = Math.max(0, totalRiskBudget - openRisk)
  const assetClassAllocation = buildAssetClassAllocation({
    analytics,
    accountValue: account.accountValue,
    targets,
    availableCapital,
  })
  const symbolAllocation = buildSymbolAllocation({
    analytics,
    accountValue: account.accountValue,
    maxSymbolWeightPct: targets.maxSymbolWeightPct,
    driftThresholdPct: targets.driftThresholdPct,
  })
  const strategyAllocation = buildStrategyAllocation({
    strategyAttribution: options.strategyAttribution,
    availableCapital,
    remainingRiskBudget,
  })
  const allocationStatus = deriveAllocationStatus({
    availableCapital,
    drawdownProtection: options.drawdownProtection,
    risk,
    assetClassAllocation,
    symbolAllocation,
  })
  const result = {
    eventType: PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'recommended',
    allocationStatus,
    account,
    capital: {
      availableCapital: round(availableCapital),
      reservedCashBuffer: round(reservedCashBuffer),
      reservedCashBufferPct: round(targets.reservedCashBufferPct),
      totalRiskBudget: round(totalRiskBudget),
      openRisk: round(openRisk),
      remainingRiskBudget: round(remainingRiskBudget),
      riskBudgetPct: round(targets.riskBudgetPct),
    },
    allocation: {
      byStrategy: strategyAllocation,
      byAssetClass: assetClassAllocation,
      bySymbol: symbolAllocation,
    },
    references: {
      portfolioRiskEvent: risk.eventType,
      portfolioAnalyticsEvent: analytics.eventType,
      performanceEvent: options.performanceSnapshot?.eventType ?? null,
      drawdownProtectionEvent: options.drawdownProtection?.eventType ?? null,
      positionSizingEvent: options.positionSizing?.eventType ?? null,
    },
    recommendations: buildRecommendations({
      allocationStatus,
      assetClassAllocation,
      symbolAllocation,
      positionSizing: options.positionSizing,
    }),
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_CAPITAL_ALLOCATION_RECOMMENDED_EVENT, result)
  }

  return result
}

export function createCapitalAllocationEngine(options = {}) {
  return {
    recommend(portfolio, allocationOptions = {}) {
      return recommendCapitalAllocation(portfolio, { ...options, ...allocationOptions })
    },
  }
}
