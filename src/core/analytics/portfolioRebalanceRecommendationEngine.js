import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'
import { evaluatePortfolioAnalytics } from './portfolioAnalyticsEngine.js'

export const PORTFOLIO_REBALANCE_RECOMMENDED_EVENT = 'portfolio.rebalance.recommended'

const defaultTargets = Object.freeze({
  assetClass: Object.freeze({
    etf: 45,
    equity: 25,
    crypto: 10,
    forex: 10,
    futures: 10,
  }),
  cashBufferPct: 20,
  maxPositionWeight: 25,
  maxGrossExposure: 125,
  maxLeverage: 1.25,
})

function numberValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function createAction({ type, scope, target, priority = 'medium', confidence = 70, rationale, metrics = {} }) {
  return {
    type,
    scope,
    target,
    priority,
    confidence: Math.max(0, Math.min(100, round(confidence))),
    rationale,
    metrics,
  }
}

function getCashBufferPct(analytics, portfolio) {
  const accountValue = numberValue(analytics.account?.accountValue ?? portfolio?.accountValue ?? portfolio?.equity)
  const cash = numberValue(analytics.account?.cash ?? portfolio?.cash)
  return accountValue > 0 ? (cash / accountValue) * 100 : 0
}

function buildDriftActions(analytics, targets) {
  const assetTargets = targets.assetClass ?? {}
  const actions = []

  for (const drift of analytics.drift?.items ?? []) {
    if (drift.scope !== 'asset_class') continue
    const actionType = drift.driftPct > 0 ? 'reduce' : 'add'
    actions.push(createAction({
      type: actionType,
      scope: 'asset_class',
      target: drift.name,
      priority: Math.abs(drift.driftPct) >= 25 ? 'high' : 'medium',
      confidence: 62 + Math.min(28, Math.abs(drift.driftPct)),
      rationale: `${drift.name} is ${Math.abs(drift.driftPct).toFixed(2)}% ${drift.driftPct > 0 ? 'overweight' : 'underweight'} versus target allocation.`,
      metrics: {
        actual: drift.actual,
        target: drift.target ?? assetTargets[drift.name] ?? 0,
        driftPct: drift.driftPct,
      },
    }))
  }

  for (const [assetType, target] of Object.entries(assetTargets)) {
    const exposure = analytics.exposure.byAssetClass.find((item) => item.assetType === assetType)
    if (!exposure && target > 0) {
      actions.push(createAction({
        type: 'add',
        scope: 'asset_class',
        target: assetType,
        priority: target >= 15 ? 'medium' : 'low',
        confidence: 58 + Math.min(20, target),
        rationale: `${assetType} has no current exposure against a ${target}% target allocation.`,
        metrics: { actual: 0, target, driftPct: -target },
      }))
    }
  }

  return actions
}

function buildConcentrationActions(analytics, targets) {
  const largest = analytics.concentration?.largestPosition
  if (!largest || numberValue(largest.weight) <= numberValue(targets.maxPositionWeight)) return []

  return [createAction({
    type: 'reduce',
    scope: 'symbol',
    target: largest.symbol,
    priority: largest.weight >= 40 ? 'high' : 'medium',
    confidence: 70 + Math.min(25, largest.weight - targets.maxPositionWeight),
    rationale: `${largest.symbol} exceeds the ${targets.maxPositionWeight}% position concentration limit.`,
    metrics: {
      weight: largest.weight,
      limit: targets.maxPositionWeight,
      excessPct: round(largest.weight - targets.maxPositionWeight),
    },
  })]
}

function buildCashBufferActions(analytics, portfolio, targets) {
  const cashBufferPct = getCashBufferPct(analytics, portfolio)
  if (cashBufferPct >= targets.cashBufferPct) return []

  return [createAction({
    type: 'reduce',
    scope: 'cash_buffer',
    target: 'cash',
    priority: cashBufferPct < targets.cashBufferPct / 2 ? 'high' : 'medium',
    confidence: 65 + Math.min(25, targets.cashBufferPct - cashBufferPct),
    rationale: `Cash buffer is ${cashBufferPct.toFixed(2)}%, below the ${targets.cashBufferPct}% paper portfolio target.`,
    metrics: {
      cashBufferPct: round(cashBufferPct),
      targetCashBufferPct: targets.cashBufferPct,
      shortfallPct: round(targets.cashBufferPct - cashBufferPct),
    },
  })]
}

function buildRiskReductionActions(analytics, targets) {
  const actions = []
  const grossExposure = numberValue(analytics.exposure?.grossExposure)
  const leverage = numberValue(analytics.exposure?.leverage)
  const riskLevel = analytics.riskSnapshot?.riskLevel

  if (grossExposure > targets.maxGrossExposure) {
    actions.push(createAction({
      type: 'reduce',
      scope: 'portfolio',
      target: 'gross_exposure',
      priority: 'high',
      confidence: 75 + Math.min(20, (grossExposure - targets.maxGrossExposure) / 2),
      rationale: `Gross exposure is ${grossExposure.toFixed(2)}%, above the ${targets.maxGrossExposure}% limit.`,
      metrics: { grossExposure, limit: targets.maxGrossExposure },
    }))
  }

  if (leverage > targets.maxLeverage) {
    actions.push(createAction({
      type: 'reduce',
      scope: 'portfolio',
      target: 'leverage',
      priority: 'high',
      confidence: 72 + Math.min(22, (leverage - targets.maxLeverage) * 20),
      rationale: `Portfolio leverage is ${leverage.toFixed(2)}x, above the ${targets.maxLeverage}x limit.`,
      metrics: { leverage, limit: targets.maxLeverage },
    }))
  }

  if (riskLevel === 'critical' || riskLevel === 'high') {
    actions.push(createAction({
      type: 'review',
      scope: 'risk',
      target: riskLevel,
      priority: riskLevel === 'critical' ? 'high' : 'medium',
      confidence: riskLevel === 'critical' ? 90 : 76,
      rationale: `Portfolio risk engine reports ${riskLevel} risk; review before adding paper exposure.`,
      metrics: { riskLevel, riskScore: analytics.riskSnapshot?.riskScore },
    }))
  }

  return actions
}

function dedupeActions(actions) {
  const seen = new Set()
  return actions.filter((action) => {
    const key = `${action.type}:${action.scope}:${action.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function getOverallConfidence(actions) {
  if (actions.length === 0) return 82
  return round(actions.reduce((sum, action) => sum + action.confidence, 0) / actions.length)
}

function buildRationale(actions) {
  if (actions.length === 0) return 'Portfolio is within paper rebalancing guardrails; hold current allocations and continue monitoring.'
  if (actions.every((action) => action.type === 'hold')) return 'Portfolio is within paper rebalancing guardrails; hold current allocations and continue monitoring.'
  const highPriority = actions.filter((action) => action.priority === 'high').length
  return `${actions.length} paper rebalancing recommendation${actions.length === 1 ? '' : 's'} generated; ${highPriority} high-priority action${highPriority === 1 ? '' : 's'} need review.`
}

export function recommendPortfolioRebalance(portfolio = {}, options = {}) {
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
  const analytics = options.analyticsSnapshot ?? evaluatePortfolioAnalytics(portfolio, {
    emitEvent: false,
    targets,
    riskSnapshot: options.riskSnapshot,
  })
  const actions = dedupeActions([
    ...buildDriftActions(analytics, targets),
    ...buildConcentrationActions(analytics, targets),
    ...buildCashBufferActions(analytics, portfolio, targets),
    ...buildRiskReductionActions(analytics, targets),
  ]).sort((left, right) => {
    const priorityRank = { high: 3, medium: 2, low: 1 }
    return (priorityRank[right.priority] - priorityRank[left.priority]) || (right.confidence - left.confidence)
  })
  const recommendations = actions.length > 0
    ? actions
    : [createAction({
        type: 'hold',
        scope: 'portfolio',
        target: 'current_allocation',
        priority: 'low',
        confidence: 82,
        rationale: 'Current paper portfolio allocation does not require rebalancing.',
      })]
  const result = {
    eventType: PORTFOLIO_REBALANCE_RECOMMENDED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'recommended',
    portfolioId: analytics.portfolioId ?? portfolio.id ?? 'paper-portfolio',
    recommendations,
    actionCounts: recommendations.reduce((counts, action) => ({
      ...counts,
      [action.type]: (counts[action.type] ?? 0) + 1,
    }), {}),
    confidence: getOverallConfidence(recommendations),
    rationaleSummary: buildRationale(recommendations),
    inputs: {
      analyticsEvent: analytics.eventType,
      riskLevel: analytics.riskSnapshot?.riskLevel,
      diversificationScore: analytics.diversification?.score,
      driftCount: analytics.drift?.items?.length ?? 0,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(PORTFOLIO_REBALANCE_RECOMMENDED_EVENT, result)
  }

  return result
}

export function createPortfolioRebalanceRecommendationEngine(options = {}) {
  return {
    recommend(portfolio, recommendationOptions = {}) {
      return recommendPortfolioRebalance(portfolio, { ...options, ...recommendationOptions })
    },
  }
}
