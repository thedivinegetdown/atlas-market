import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT = 'portfolio.optimization.recommended'

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

function getPortfolioAnalytics(input = {}) {
  return input.portfolioAnalytics ?? input.analytics ?? {}
}

function getPortfolioCorrelation(input = {}) {
  return input.portfolioCorrelation ?? input.correlation ?? {}
}

function getFactorExposure(input = {}) {
  return input.portfolioFactorExposure ?? input.factorExposure ?? {}
}

function getCapitalAllocation(input = {}) {
  return input.capitalAllocation ?? input.portfolioCapitalAllocation ?? {}
}

function getPortfolioRisk(input = {}) {
  return input.portfolioRisk ?? input.risk ?? {}
}

function getPerformance(input = {}) {
  return input.performance ?? input.paperPerformance ?? {}
}

function getStrategyAttribution(input = {}) {
  return input.strategyAttribution ?? input.attribution ?? {}
}

function makeRecommendation({ id, category, priority = 'medium', action, rationale, sourceEvents = [] }) {
  return {
    id,
    category,
    priority,
    action,
    rationale,
    sourceEvents: sourceEvents.filter(Boolean),
    paperTrading: true,
    liveOrders: false,
    recommendationOnly: true,
  }
}

function buildRiskReductionRecommendations({ risk, factorExposure }) {
  const recommendations = []
  const riskLevel = risk.summary?.riskLevel ?? 'unknown'

  if (['critical', 'high'].includes(riskLevel)) {
    recommendations.push(makeRecommendation({
      id: 'risk-reduce-gross-exposure',
      category: 'risk_reduction',
      priority: 'high',
      action: 'Reduce gross exposure in paper portfolio before adding new risk',
      rationale: `Portfolio risk level is ${riskLevel} with ${round(risk.summary?.grossExposure)}% gross exposure.`,
      sourceEvents: [risk.eventType],
    }))
  }

  if (numberValue(risk.summary?.openRiskPct) > 2) {
    recommendations.push(makeRecommendation({
      id: 'risk-reduce-open-risk',
      category: 'risk_reduction',
      priority: numberValue(risk.summary?.openRiskPct) > 3 ? 'high' : 'medium',
      action: 'Prioritize paper risk reduction on positions with the largest open risk',
      rationale: `Open risk is ${round(risk.summary?.openRiskPct)}% of account value.`,
      sourceEvents: [risk.eventType],
    }))
  }

  if (factorExposure.volatilityFactorExposure?.status === 'elevated') {
    recommendations.push(makeRecommendation({
      id: 'risk-reduce-volatility-factor',
      category: 'risk_reduction',
      priority: 'medium',
      action: 'Prefer lower-volatility paper substitutions before increasing allocation',
      rationale: `Volatility factor score is ${round(factorExposure.volatilityFactorExposure.exposureScore)}.`,
      sourceEvents: [factorExposure.eventType],
    }))
  }

  return recommendations.length > 0 ? recommendations : [
    makeRecommendation({
      id: 'risk-maintain-controls',
      category: 'risk_reduction',
      priority: 'low',
      action: 'Maintain current paper risk controls',
      rationale: 'No material portfolio risk reduction trigger was detected.',
      sourceEvents: [risk.eventType],
    }),
  ]
}

function buildDiversificationRecommendations({ analytics }) {
  const recommendations = []
  const diversification = analytics.diversification ?? {}
  const largestPosition = analytics.concentration?.largestPosition

  if (diversification.label === 'concentrated' || numberValue(diversification.score) < 55) {
    recommendations.push(makeRecommendation({
      id: 'diversification-improve-breadth',
      category: 'diversification',
      priority: 'high',
      action: 'Improve paper portfolio breadth before increasing concentrated exposures',
      rationale: `Diversification score is ${round(diversification.score)} and classified as ${diversification.label}.`,
      sourceEvents: [analytics.eventType],
    }))
  }

  if (numberValue(largestPosition?.weight) > 25) {
    recommendations.push(makeRecommendation({
      id: 'diversification-trim-largest-position',
      category: 'diversification',
      priority: 'medium',
      action: `Review ${largestPosition.symbol} paper weight for staged reduction`,
      rationale: `${largestPosition.symbol} is the largest position at ${round(largestPosition.weight)}%.`,
      sourceEvents: [analytics.eventType],
    }))
  }

  const driftItems = analytics.drift?.items ?? []
  if (driftItems.length > 0) {
    recommendations.push(makeRecommendation({
      id: 'diversification-address-drift',
      category: 'diversification',
      priority: 'medium',
      action: 'Use paper rebalance candidates to address portfolio drift',
      rationale: `${driftItems.length} drift items are present in portfolio analytics.`,
      sourceEvents: [analytics.eventType],
    }))
  }

  return recommendations.length > 0 ? recommendations : [
    makeRecommendation({
      id: 'diversification-maintain-balance',
      category: 'diversification',
      priority: 'low',
      action: 'Maintain current diversification posture',
      rationale: `Diversification is ${diversification.label ?? 'stable'} with score ${round(diversification.score)}.`,
      sourceEvents: [analytics.eventType],
    }),
  ]
}

function buildFactorExposureAdjustmentRecommendations({ factorExposure }) {
  const recommendations = []
  const elevated = factorExposure.factorConcentrationSummary?.elevatedFactors ?? []
  const caution = factorExposure.factorConcentrationSummary?.cautionFactors ?? []

  for (const factor of elevated) {
    recommendations.push(makeRecommendation({
      id: `factor-reduce-${factor.factor}`,
      category: 'factor_exposure_adjustment',
      priority: 'high',
      action: `Reduce incremental paper exposure to ${factor.factor} factor`,
      rationale: `${factor.factor} factor is elevated with score ${round(factor.score)}.`,
      sourceEvents: [factorExposure.eventType],
    }))
  }

  for (const factor of caution.slice(0, 2)) {
    recommendations.push(makeRecommendation({
      id: `factor-monitor-${factor.factor}`,
      category: 'factor_exposure_adjustment',
      priority: 'medium',
      action: `Monitor ${factor.factor} factor before adding new paper positions`,
      rationale: `${factor.factor} factor is in caution with score ${round(factor.score)}.`,
      sourceEvents: [factorExposure.eventType],
    }))
  }

  return recommendations.length > 0 ? recommendations : [
    makeRecommendation({
      id: 'factor-maintain-current-mix',
      category: 'factor_exposure_adjustment',
      priority: 'low',
      action: 'Maintain current factor mix',
      rationale: `Factor risk status is ${factorExposure.factorRiskStatus ?? 'unknown'}.`,
      sourceEvents: [factorExposure.eventType],
    }),
  ]
}

function buildCorrelationReductionRecommendations({ correlation }) {
  const recommendations = []
  const concentration = correlation.concentrationRiskFromCorrelatedAssets ?? {}
  const highPairs = concentration.highCorrelationPairs ?? []

  if (correlation.correlationRiskStatus === 'elevated' || numberValue(concentration.correlatedWeight) >= 45) {
    recommendations.push(makeRecommendation({
      id: 'correlation-reduce-cluster-weight',
      category: 'correlation_reduction',
      priority: 'high',
      action: 'Reduce additions to correlated paper positions until cluster weight normalizes',
      rationale: `Correlated symbol weight is ${round(concentration.correlatedWeight)}%.`,
      sourceEvents: [correlation.eventType],
    }))
  }

  if (highPairs.length > 0) {
    const pair = highPairs[0]
    recommendations.push(makeRecommendation({
      id: 'correlation-review-high-pair',
      category: 'correlation_reduction',
      priority: correlation.correlationRiskStatus === 'elevated' ? 'high' : 'medium',
      action: `Review ${pair.left}/${pair.right} as a high-correlation paper pair`,
      rationale: `${pair.left}/${pair.right} correlation is ${round(pair.correlation, 4)} across ${pair.observations} observations.`,
      sourceEvents: [correlation.eventType],
    }))
  }

  return recommendations.length > 0 ? recommendations : [
    makeRecommendation({
      id: 'correlation-maintain-monitoring',
      category: 'correlation_reduction',
      priority: 'low',
      action: 'Maintain current correlation monitoring',
      rationale: `Correlation risk status is ${correlation.correlationRiskStatus ?? 'unknown'}.`,
      sourceEvents: [correlation.eventType],
    }),
  ]
}

function buildCapitalAllocationAdjustmentRecommendations({ capitalAllocation }) {
  const recommendations = []
  const allocationStatus = capitalAllocation.allocationStatus ?? 'unknown'
  const overweightAsset = (capitalAllocation.allocation?.byAssetClass ?? []).find((item) => item.allocationState === 'overweight')
  const underweightAsset = (capitalAllocation.allocation?.byAssetClass ?? []).find((item) => item.allocationState === 'underweight')
  const overweightSymbol = (capitalAllocation.allocation?.bySymbol ?? []).find((item) => item.allocationState === 'overweight')

  if (allocationStatus === 'constrained') {
    recommendations.push(makeRecommendation({
      id: 'capital-preserve-cash',
      category: 'capital_allocation_adjustment',
      priority: 'high',
      action: 'Preserve paper cash buffer and pause new allocation increases',
      rationale: 'Capital allocation engine classified allocation as constrained.',
      sourceEvents: [capitalAllocation.eventType],
    }))
  }

  if (overweightAsset) {
    recommendations.push(makeRecommendation({
      id: `capital-reduce-${overweightAsset.assetType}`,
      category: 'capital_allocation_adjustment',
      priority: 'medium',
      action: `Reduce new paper capital assigned to ${overweightAsset.assetType}`,
      rationale: `${overweightAsset.assetType} is ${round(overweightAsset.driftPct)}% over target.`,
      sourceEvents: [capitalAllocation.eventType],
    }))
  }

  if (underweightAsset && allocationStatus !== 'constrained') {
    recommendations.push(makeRecommendation({
      id: `capital-add-${underweightAsset.assetType}`,
      category: 'capital_allocation_adjustment',
      priority: 'low',
      action: `Route available paper capital toward ${underweightAsset.assetType} candidates`,
      rationale: `${underweightAsset.assetType} is ${Math.abs(round(underweightAsset.driftPct))}% under target.`,
      sourceEvents: [capitalAllocation.eventType],
    }))
  }

  if (overweightSymbol) {
    recommendations.push(makeRecommendation({
      id: `capital-cap-${overweightSymbol.symbol}`,
      category: 'capital_allocation_adjustment',
      priority: 'medium',
      action: `Cap incremental paper allocation to ${overweightSymbol.symbol}`,
      rationale: `${overweightSymbol.symbol} exceeds configured symbol allocation cap.`,
      sourceEvents: [capitalAllocation.eventType],
    }))
  }

  return recommendations.length > 0 ? recommendations : [
    makeRecommendation({
      id: 'capital-maintain-allocation',
      category: 'capital_allocation_adjustment',
      priority: 'low',
      action: 'Maintain current capital allocation plan',
      rationale: `Capital allocation status is ${allocationStatus}.`,
      sourceEvents: [capitalAllocation.eventType],
    }),
  ]
}

function buildStrategyAllocationRecommendations({ strategyAttribution, capitalAllocation, performance }) {
  const recommendations = []
  const poorStrategies = (strategyAttribution.strategies ?? []).filter((strategy) => (
    numberValue(strategy.trades) > 0
    && (numberValue(strategy.profitFactor) < 1 || numberValue(strategy.netRealizedPnl) < 0)
  ))
  const bestStrategy = (capitalAllocation.allocation?.byStrategy ?? [])[0]

  for (const strategy of poorStrategies.slice(0, 2)) {
    recommendations.push(makeRecommendation({
      id: `strategy-reduce-${String(strategy.strategy).toLowerCase().replace(/\s+/g, '-')}`,
      category: 'strategy_allocation',
      priority: 'medium',
      action: `Reduce paper allocation weight for ${strategy.strategy}`,
      rationale: `${strategy.strategy} has ${round(strategy.profitFactor)} profit factor and ${round(strategy.netRealizedPnl)} net realized P&L.`,
      sourceEvents: [strategyAttribution.eventType],
    }))
  }

  if (bestStrategy && numberValue(bestStrategy.allocationScore) >= 70 && numberValue(performance.metrics?.netRealizedPnl) >= 0) {
    recommendations.push(makeRecommendation({
      id: `strategy-prioritize-${String(bestStrategy.strategy).toLowerCase().replace(/\s+/g, '-')}`,
      category: 'strategy_allocation',
      priority: 'low',
      action: `Prioritize paper review queue for ${bestStrategy.strategy}`,
      rationale: `${bestStrategy.strategy} has the top allocation score at ${round(bestStrategy.allocationScore)}.`,
      sourceEvents: [capitalAllocation.eventType, strategyAttribution.eventType, performance.eventType],
    }))
  }

  return recommendations.length > 0 ? recommendations : [
    makeRecommendation({
      id: 'strategy-maintain-allocation',
      category: 'strategy_allocation',
      priority: 'low',
      action: 'Maintain current strategy allocation mix',
      rationale: 'No strategy allocation downgrade trigger was detected.',
      sourceEvents: [strategyAttribution.eventType],
    }),
  ]
}

function calculateOptimizationConfidenceScore({ sources, recommendations }) {
  const availableSources = Object.values(sources).filter(Boolean).length
  const actionableCount = recommendations.filter((item) => item.priority !== 'low').length
  const highCount = recommendations.filter((item) => item.priority === 'high').length
  return round(clamp(35 + (availableSources * 7) + Math.min(12, actionableCount * 2) + Math.min(8, highCount * 2), 5, 95))
}

function resolveRecommendationPriority(recommendations = []) {
  if (recommendations.some((item) => item.priority === 'high')) return 'high'
  if (recommendations.some((item) => item.priority === 'medium')) return 'medium'
  return 'low'
}

export function recommendPortfolioOptimization(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? getNowIso()
  const portfolioAnalytics = getPortfolioAnalytics(input)
  const portfolioCorrelation = getPortfolioCorrelation(input)
  const portfolioFactorExposure = getFactorExposure(input)
  const capitalAllocation = getCapitalAllocation(input)
  const portfolioRisk = getPortfolioRisk(input)
  const performance = getPerformance(input)
  const strategyAttribution = getStrategyAttribution(input)
  const riskReductionRecommendations = buildRiskReductionRecommendations({
    risk: portfolioRisk,
    factorExposure: portfolioFactorExposure,
  })
  const diversificationRecommendations = buildDiversificationRecommendations({ analytics: portfolioAnalytics })
  const factorExposureAdjustmentRecommendations = buildFactorExposureAdjustmentRecommendations({
    factorExposure: portfolioFactorExposure,
  })
  const correlationReductionRecommendations = buildCorrelationReductionRecommendations({
    correlation: portfolioCorrelation,
  })
  const capitalAllocationAdjustmentRecommendations = buildCapitalAllocationAdjustmentRecommendations({
    capitalAllocation,
  })
  const strategyAllocationRecommendations = buildStrategyAllocationRecommendations({
    strategyAttribution,
    capitalAllocation,
    performance,
  })
  const allRecommendations = [
    ...riskReductionRecommendations,
    ...diversificationRecommendations,
    ...factorExposureAdjustmentRecommendations,
    ...correlationReductionRecommendations,
    ...capitalAllocationAdjustmentRecommendations,
    ...strategyAllocationRecommendations,
  ]
  const sourceEvents = {
    portfolioAnalytics: portfolioAnalytics.eventType ?? null,
    portfolioCorrelation: portfolioCorrelation.eventType ?? null,
    portfolioFactorExposure: portfolioFactorExposure.eventType ?? null,
    capitalAllocation: capitalAllocation.eventType ?? null,
    portfolioRisk: portfolioRisk.eventType ?? null,
    performance: performance.eventType ?? null,
    strategyAttribution: strategyAttribution.eventType ?? null,
  }
  const optimizationConfidenceScore = calculateOptimizationConfidenceScore({
    sources: sourceEvents,
    recommendations: allRecommendations,
  })
  const recommendationPriority = resolveRecommendationPriority(allRecommendations)
  const result = {
    eventType: PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT,
    paperTrading: true,
    liveOrders: false,
    brokerageIntegration: false,
    recommendationOnly: true,
    timestamp,
    riskReductionRecommendations,
    diversificationRecommendations,
    factorExposureAdjustmentRecommendations,
    correlationReductionRecommendations,
    capitalAllocationAdjustmentRecommendations,
    strategyAllocationRecommendations,
    recommendationSummary: {
      totalRecommendations: allRecommendations.length,
      highPriority: allRecommendations.filter((item) => item.priority === 'high').length,
      mediumPriority: allRecommendations.filter((item) => item.priority === 'medium').length,
      lowPriority: allRecommendations.filter((item) => item.priority === 'low').length,
    },
    optimizationConfidenceScore,
    recommendationPriority,
    summary: `Portfolio optimization ${recommendationPriority} priority with ${optimizationConfidenceScore} confidence across ${allRecommendations.length} paper-only recommendations.`,
    sourceEvents,
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_OPTIMIZATION_RECOMMENDED_EVENT, result)
  }

  return result
}

export function createPortfolioOptimizationRecommendationEngine(options = {}) {
  return {
    recommend(input, recommendationOptions = {}) {
      return recommendPortfolioOptimization(input, { ...options, ...recommendationOptions })
    },
  }
}
