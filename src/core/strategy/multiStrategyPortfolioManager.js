import { eventBus as defaultEventBus } from '../../../lib/core/eventBus.js'

export const STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT = 'strategy.portfolioManager.evaluated'

function numberValue(value, fallback = 0) {
  if (value === null || value === undefined || value === '') return fallback
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function round(value, decimals = 2) {
  return Number(numberValue(value).toFixed(decimals))
}

function normalizeSymbol(symbol) {
  return String(symbol ?? '').trim().toUpperCase()
}

function getStrategyName(value = {}) {
  return String(value.strategy ?? value.name ?? value.id ?? 'Unattributed').trim() || 'Unattributed'
}

function normalizeDirection(value = {}) {
  const side = String(value.direction ?? value.side ?? value.signal ?? '').trim().toLowerCase()
  if (['buy', 'long', 'bullish', 'strong_buy'].includes(side)) return 'long'
  if (['sell', 'short', 'bearish', 'strong_sell'].includes(side)) return 'short'
  return 'neutral'
}

function buildRegistry(activeStrategies = [], strategyAttribution = {}) {
  const attributedStrategies = strategyAttribution.strategies ?? []
  const configured = activeStrategies.length > 0
    ? activeStrategies
    : attributedStrategies.map((strategy, index) => ({
        id: strategy.strategy,
        name: strategy.strategy,
        priority: index + 1,
        enabled: true,
      }))

  const attributionByName = new Map(attributedStrategies.map((strategy) => [strategy.strategy, strategy]))

  return configured.map((strategy, index) => {
    const name = getStrategyName(strategy)
    const attribution = attributionByName.get(name) ?? {}

    return {
      id: String(strategy.id ?? name),
      name,
      enabled: strategy.enabled !== false,
      priority: numberValue(strategy.priority, index + 1),
      maxExposurePct: numberValue(strategy.maxExposurePct, 20),
      riskBudgetPct: numberValue(strategy.riskBudgetPct, 1),
      allowedAssetTypes: Array.isArray(strategy.allowedAssetTypes) ? strategy.allowedAssetTypes : [],
      attribution: {
        trades: numberValue(attribution.trades),
        winRate: numberValue(attribution.winRate),
        profitFactor: numberValue(attribution.profitFactor),
        expectancy: numberValue(attribution.expectancy),
        netRealizedPnl: numberValue(attribution.netRealizedPnl),
      },
    }
  }).sort((left, right) => left.priority - right.priority)
}

function normalizeProposedTrades(proposedTrades = []) {
  return proposedTrades.map((trade, index) => ({
    id: String(trade.id ?? `proposed-${index + 1}`),
    strategy: getStrategyName(trade),
    symbol: normalizeSymbol(trade.symbol),
    assetType: String(trade.assetType ?? 'equity').trim().toLowerCase(),
    direction: normalizeDirection(trade),
    notional: numberValue(trade.notional ?? trade.price * trade.quantity),
    riskPct: numberValue(trade.riskPct),
    paperTrading: trade.paperTrading !== false,
  }))
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item)
    const current = groups.get(key) ?? []
    current.push(item)
    groups.set(key, current)
    return groups
  }, new Map())
}

function detectDuplicateSymbols(trades) {
  return Array.from(groupBy(trades.filter((trade) => trade.symbol), (trade) => trade.symbol).entries())
    .filter(([, symbolTrades]) => symbolTrades.length > 1)
    .map(([symbol, symbolTrades]) => ({
      symbol,
      strategies: [...new Set(symbolTrades.map((trade) => trade.strategy))].sort(),
      tradeIds: symbolTrades.map((trade) => trade.id),
    }))
}

function detectConflictingSignals(trades) {
  return Array.from(groupBy(trades.filter((trade) => trade.symbol), (trade) => trade.symbol).entries())
    .map(([symbol, symbolTrades]) => {
      const directions = [...new Set(symbolTrades.map((trade) => trade.direction).filter((direction) => direction !== 'neutral'))]
      if (!(directions.includes('long') && directions.includes('short'))) return null

      return {
        symbol,
        directions,
        strategies: [...new Set(symbolTrades.map((trade) => trade.strategy))].sort(),
        tradeIds: symbolTrades.map((trade) => trade.id),
      }
    })
    .filter(Boolean)
}

function getAllocationForStrategy(capitalAllocation, strategyName) {
  return (capitalAllocation?.allocation?.byStrategy ?? []).find((item) => item.strategy === strategyName) ?? null
}

function getAIDecisionForStrategy(aiDecisions, strategyName) {
  return aiDecisions.find((decision) => getStrategyName(decision.decisionInput?.proposedTrade ?? decision.proposedTrade ?? {}) === strategyName) ?? null
}

function buildStrategyEvaluations({ registry, proposedTrades, aiDecisions, capitalAllocation, portfolioRisk, duplicateSymbols, conflictingSignals }) {
  const accountValue = numberValue(capitalAllocation?.account?.accountValue ?? portfolioRisk?.account?.accountValue)
  const duplicatesByStrategy = new Map()
  const conflictsByStrategy = new Map()

  for (const duplicate of duplicateSymbols) {
    for (const strategy of duplicate.strategies) {
      duplicatesByStrategy.set(strategy, [...(duplicatesByStrategy.get(strategy) ?? []), duplicate.symbol])
    }
  }

  for (const conflict of conflictingSignals) {
    for (const strategy of conflict.strategies) {
      conflictsByStrategy.set(strategy, [...(conflictsByStrategy.get(strategy) ?? []), conflict.symbol])
    }
  }

  return registry.map((strategy) => {
    const strategyTrades = proposedTrades.filter((trade) => trade.strategy === strategy.name)
    const proposedNotional = strategyTrades.reduce((sum, trade) => sum + Math.abs(numberValue(trade.notional)), 0)
    const proposedExposurePct = accountValue > 0 ? (proposedNotional / accountValue) * 100 : 0
    const proposedRiskPct = strategyTrades.reduce((sum, trade) => sum + numberValue(trade.riskPct), 0)
    const allocation = getAllocationForStrategy(capitalAllocation, strategy.name)
    const aiDecision = getAIDecisionForStrategy(aiDecisions, strategy.name)
    const blockers = []
    const cautions = []

    if (!strategy.enabled) blockers.push('Strategy is disabled')
    if (strategyTrades.some((trade) => trade.paperTrading === false)) blockers.push('Only paper strategy trades are supported')
    if ((duplicatesByStrategy.get(strategy.name) ?? []).length > 0) blockers.push('Duplicate symbol trade detected')
    if ((conflictsByStrategy.get(strategy.name) ?? []).length > 0) blockers.push('Conflicting signal detected')
    if (proposedExposurePct > strategy.maxExposurePct) blockers.push('Strategy exposure limit exceeded')
    if (proposedRiskPct > strategy.riskBudgetPct) blockers.push('Strategy risk budget exceeded')
    if (aiDecision?.finalDecision === 'reject') blockers.push('AI decision rejected strategy trade')

    if (aiDecision?.finalDecision === 'caution' || aiDecision?.finalDecision === 'watchlist') cautions.push(`AI decision is ${aiDecision.finalDecision}`)
    if (allocation?.allocationState === 'underweight') cautions.push('Strategy allocation is underweight')
    if (allocation?.allocationState === 'overweight') cautions.push('Strategy allocation is overweight')
    if (strategy.attribution.profitFactor > 0 && strategy.attribution.profitFactor < 1) cautions.push('Strategy profit factor is below one')

    const approvalStatus = blockers.length > 0 ? 'blocked' : cautions.length > 0 ? 'caution' : 'approved'

    return {
      strategyId: strategy.id,
      strategy: strategy.name,
      priority: strategy.priority,
      enabled: strategy.enabled,
      approvalStatus,
      proposedTrades: strategyTrades.length,
      proposedExposurePct: round(proposedExposurePct),
      maxExposurePct: round(strategy.maxExposurePct),
      proposedRiskPct: round(proposedRiskPct),
      riskBudgetPct: round(strategy.riskBudgetPct),
      allocationState: allocation?.allocationState ?? 'not_allocated',
      aiDecision: aiDecision?.finalDecision ?? 'not_evaluated',
      blockers,
      cautions,
      attribution: strategy.attribution,
    }
  })
}

function summarizeStatus(strategyEvaluations) {
  if (strategyEvaluations.some((strategy) => strategy.approvalStatus === 'blocked')) return 'blocked'
  if (strategyEvaluations.some((strategy) => strategy.approvalStatus === 'caution')) return 'caution'
  return 'approved'
}

export function evaluateMultiStrategyPortfolioManager(input = {}, options = {}) {
  const eventBus = options.eventBus ?? defaultEventBus
  const emitEvent = options.emitEvent !== false
  const timestamp = options.timestamp ?? new Date().toISOString()
  const registry = buildRegistry(input.activeStrategies ?? [], input.strategyAttribution ?? {})
  const proposedTrades = normalizeProposedTrades(input.proposedTrades ?? [])
  const aiDecisions = Array.isArray(input.aiDecisions)
    ? input.aiDecisions
    : input.aiDecision
      ? [input.aiDecision]
      : []
  const duplicateSymbols = detectDuplicateSymbols(proposedTrades)
  const conflictingSignals = detectConflictingSignals(proposedTrades)
  const strategyEvaluations = buildStrategyEvaluations({
    registry,
    proposedTrades,
    aiDecisions,
    capitalAllocation: input.capitalAllocation,
    portfolioRisk: input.portfolioRisk,
    duplicateSymbols,
    conflictingSignals,
  })
  const strategyApprovalStatus = summarizeStatus(strategyEvaluations)
  const priorityRanking = registry.map((strategy) => ({
    strategyId: strategy.id,
    strategy: strategy.name,
    priority: strategy.priority,
  }))

  const result = {
    eventType: STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT,
    paperTrading: true,
    timestamp,
    status: 'evaluated',
    strategyApprovalStatus,
    activeStrategyRegistry: registry,
    priorityRanking,
    strategyEvaluations,
    duplicateSymbolTrades: duplicateSymbols,
    conflictingSignals,
    references: {
      aiDecisionEvents: aiDecisions.map((decision) => decision.eventType).filter(Boolean),
      capitalAllocationEvent: input.capitalAllocation?.eventType ?? null,
      portfolioAnalyticsEvent: input.portfolioAnalytics?.eventType ?? null,
      strategyAttributionEvent: input.strategyAttribution?.eventType ?? null,
      portfolioRiskEvent: input.portfolioRisk?.eventType ?? null,
    },
  }

  if (emitEvent && eventBus?.emit) {
    eventBus.emit(STRATEGY_PORTFOLIO_MANAGER_EVALUATED_EVENT, result)
  }

  return result
}

export function createMultiStrategyPortfolioManager(options = {}) {
  return {
    evaluate(input, evaluationOptions = {}) {
      return evaluateMultiStrategyPortfolioManager(input, { ...options, ...evaluationOptions })
    },
  }
}
